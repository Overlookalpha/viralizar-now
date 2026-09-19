const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

// Guarda a chave da API fora do código-fonte.
// Definir com: firebase functions:secrets:set BARATOS_API_KEY
const BARATOS_API_KEY = defineSecret("BARATOS_API_KEY");
const BARATOS_URL = "https://baratosociais.com/api/v2";

// Access Token de produção do Mercado Pago (conta do vendedor, não do cliente).
// Definir com: firebase functions:secrets:set MERCADOPAGO_ACCESS_TOKEN
const MP_ACCESS_TOKEN = defineSecret("MERCADOPAGO_ACCESS_TOKEN");

const SITE_URL = "https://overlookalpha.github.io/viralizar-now";
const FUNCOES_URL = "https://us-central1-viralizar-now-d6218.cloudfunctions.net";

// Margem padrão aplicada a serviços novos, até o admin ajustar manualmente
const MARGEM_PADRAO_PERCENTUAL = 30;

// Valor mínimo aceito numa recarga de saldo, em reais
const RECARGA_MINIMA = 5;

async function chamarBaratos(apiKey, params) {
  const corpo = new URLSearchParams({ key: apiKey, ...params });
  const resp = await fetch(BARATOS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo
  });
  if (!resp.ok) {
    throw new Error("Baratos Sociais respondeu " + resp.status);
  }
  return resp.json();
}

async function exigirAdmin(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists || !doc.data().isAdmin) {
    throw new HttpsError("permission-denied", "Apenas administradores podem fazer isso.");
  }
}

// ---------- Sincroniza o catálogo de serviços do provedor ----------
exports.sincronizarServicos = onCall(
  { secrets: [BARATOS_API_KEY], timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    await exigirAdmin(request.auth && request.auth.uid);

    const servicos = await chamarBaratos(BARATOS_API_KEY.value(), { action: "services" });
    if (!Array.isArray(servicos)) {
      throw new HttpsError("internal", "Resposta inesperada da Baratos Sociais.");
    }

    // Busca todos os serviços já cadastrados de uma vez só, em vez de fazer
    // uma leitura por item (o que antes causava timeout com catálogos grandes).
    const existentesSnap = await db.collection("services").get();
    const existentesPorId = new Map();
    existentesSnap.forEach((doc) => existentesPorId.set(doc.id, doc.data()));

    const TAMANHO_LOTE = 450; // limite do Firestore é 500 operações por batch
    let lote = db.batch();
    let operacoesNoLote = 0;

    for (const s of servicos) {
      const id = String(s.service);
      const ref = db.collection("services").doc(id);
      const dadosExistentes = existentesPorId.get(id);
      const custo = Number(s.rate);
      const margem = dadosExistentes
        ? (dadosExistentes.margemPercentual ?? MARGEM_PADRAO_PERCENTUAL)
        : MARGEM_PADRAO_PERCENTUAL;

      lote.set(ref, {
        providerServiceId: id,
        nome: s.name,
        categoria: s.category || "Geral",
        tipo: s.type || "Default",
        precoCusto: custo,
        margemPercentual: margem,
        precoVenda: Number((custo * (1 + margem / 100)).toFixed(2)),
        min: Number(s.min),
        max: Number(s.max),
        aceitaReposicao: !!s.refill,
        aceitaCancelamento: !!s.cancel,
        // serviços novos entram desativados; existentes mantêm o estado atual
        ativo: dadosExistentes ? dadosExistentes.ativo : false,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      operacoesNoLote++;
      if (operacoesNoLote === TAMANHO_LOTE) {
        await lote.commit();
        lote = db.batch();
        operacoesNoLote = 0;
      }
    }

    if (operacoesNoLote > 0) {
      await lote.commit();
    }

    return { total: servicos.length };
  }
);

// ---------- Cria um pedido: debita saldo e envia à Baratos Sociais ----------
exports.criarPedido = onCall({ secrets: [BARATOS_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");

  const { serviceId, link, quantidade } = request.data;
  if (!serviceId || !link || !quantidade) {
    throw new HttpsError("invalid-argument", "Preencha serviço, link e quantidade.");
  }

  const servicoRef = db.collection("services").doc(String(serviceId));
  const usuarioRef = db.collection("users").doc(uid);

  // Reserva o saldo numa transação, antes de chamar a API externa
  const { valor, servico, usuarioEmail } = await db.runTransaction(async (tx) => {
    const [servicoSnap, usuarioSnap] = await Promise.all([tx.get(servicoRef), tx.get(usuarioRef)]);
    if (!servicoSnap.exists || !servicoSnap.data().ativo) {
      throw new HttpsError("not-found", "Serviço indisponível.");
    }
    const s = servicoSnap.data();
    if (!Number.isInteger(quantidade)) {
      throw new HttpsError("invalid-argument", "Quantidade deve ser um número inteiro.");
    }
    if (quantidade < s.min || quantidade > s.max) {
      throw new HttpsError("invalid-argument", "Quantidade deve estar entre " + s.min + " e " + s.max + ".");
    }
    const valorPedido = Number(((quantidade / 1000) * s.precoVenda).toFixed(2));
    const saldoAtual = usuarioSnap.data().saldo || 0;
    if (saldoAtual < valorPedido) {
      throw new HttpsError("failed-precondition", "Saldo insuficiente.");
    }
    tx.update(usuarioRef, { saldo: Number((saldoAtual - valorPedido).toFixed(2)) });
    return { valor: valorPedido, servico: s, usuarioEmail: usuarioSnap.data().email };
  });

  // Cria o registro do pedido como "pendente" antes de chamar o provedor
  const pedidoRef = await db.collection("orders").add({
    uid,
    usuarioEmail,
    serviceId: String(serviceId),
    servicoNome: servico.nome,
    link,
    quantidade,
    valor,
    status: "pendente",
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    const resposta = await chamarBaratos(BARATOS_API_KEY.value(), {
      action: "add",
      service: servico.providerServiceId,
      link,
      quantity: quantidade
    });

    if (resposta.error) throw new Error(resposta.error);

    await pedidoRef.update({
      status: "in progress",
      baratosOrderId: String(resposta.order)
    });
    return { orderId: pedidoRef.id, baratosOrderId: resposta.order };

  } catch (erro) {
    // Falhou no provedor: estorna o saldo e marca o pedido com erro
    await Promise.all([
      usuarioRef.update({ saldo: admin.firestore.FieldValue.increment(valor) }),
      pedidoRef.update({ status: "erro", erroMensagem: String(erro.message || erro) })
    ]);
    throw new HttpsError("internal", "Não foi possível enviar o pedido ao provedor. Saldo estornado.");
  }
});

// ---------- Consulta o saldo da conta na Baratos Sociais ----------
exports.consultarSaldoProvedor = onCall({ secrets: [BARATOS_API_KEY], timeoutSeconds: 60 }, async (request) => {
  await exigirAdmin(request.auth && request.auth.uid);
  return chamarBaratos(BARATOS_API_KEY.value(), { action: "balance" });
});

// ---------- Sincroniza status dos pedidos em aberto (a cada 10 minutos) ----------
exports.sincronizarStatusPedidos = onSchedule(
  { schedule: "every 10 minutes", secrets: [BARATOS_API_KEY], timeoutSeconds: 120 },
  async () => {
    const emAberto = await db.collection("orders")
      .where("status", "in", ["pendente", "in progress", "processing", "partial"])
      .where("baratosOrderId", "!=", null)
      .get();

    if (emAberto.empty) return;

    const idsPorDoc = emAberto.docs.map(d => ({ doc: d, orderId: d.data().baratosOrderId }));
    const idsUnicos = idsPorDoc.map(i => i.orderId).join(",");

    const statusResp = await chamarBaratos(BARATOS_API_KEY.value(), {
      action: "status",
      orders: idsUnicos
    });

    const lote = db.batch();
    for (const { doc, orderId } of idsPorDoc) {
      const info = statusResp[orderId];
      if (!info || info.error) continue;
      lote.update(doc.ref, {
        status: (info.status || "").toLowerCase(),
        restante: info.remains != null ? Number(info.remains) : null,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    await lote.commit();
  }
);

// ---------- Cria uma preferência de pagamento no Mercado Pago (Checkout Pro) ----------
exports.criarPreferenciaPagamento = onCall({ secrets: [MP_ACCESS_TOKEN], timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");

  const valor = Number(request.data && request.data.valor);
  if (!valor || valor < RECARGA_MINIMA) {
    throw new HttpsError("invalid-argument", "Informe um valor de pelo menos R$ " + RECARGA_MINIMA.toFixed(2) + ".");
  }

  const valorArredondado = Number(valor.toFixed(2));

  // Cria o registro da recarga como "pendente" antes de chamar o Mercado Pago,
  // para o webhook conseguir localizá-lo pelo external_reference.
  const recargaRef = await db.collection("recargas").add({
    uid,
    valor: valorArredondado,
    status: "pendente",
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  const corpo = {
    items: [{
      title: "Recarga de saldo - Viralizar",
      quantity: 1,
      unit_price: valorArredondado,
      currency_id: "BRL"
    }],
    external_reference: recargaRef.id,
    back_urls: {
      success: SITE_URL + "/painel.html?pagamento=sucesso",
      failure: SITE_URL + "/painel.html?pagamento=falha",
      pending: SITE_URL + "/painel.html?pagamento=pendente"
    },
    auto_return: "approved",
    notification_url: FUNCOES_URL + "/webhookMercadoPago"
  };

  const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + MP_ACCESS_TOKEN.value()
    },
    body: JSON.stringify(corpo)
  });

  if (!resp.ok) {
    const detalhe = await resp.text();
    console.error("Mercado Pago respondeu erro ao criar preferência:", resp.status, detalhe);
    await recargaRef.update({ status: "erro" });
    throw new HttpsError("internal", "Não foi possível iniciar o pagamento. Tente novamente.");
  }

  const preferencia = await resp.json();
  await recargaRef.update({ mercadopagoPreferenceId: preferencia.id });

  return { initPoint: preferencia.init_point };
});

// ---------- Cria um pagamento Pix direto: QR code exibido no próprio site ----------
exports.criarPagamentoPix = onCall({ secrets: [MP_ACCESS_TOKEN], timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");

  const valor = Number(request.data && request.data.valor);
  if (!valor || valor < RECARGA_MINIMA) {
    throw new HttpsError("invalid-argument", "Informe um valor de pelo menos R$ " + RECARGA_MINIMA.toFixed(2) + ".");
  }

  const usuarioSnap = await db.collection("users").doc(uid).get();
  const email = (usuarioSnap.exists && usuarioSnap.data().email) ||
    (request.auth.token && request.auth.token.email);
  if (!email) {
    throw new HttpsError("failed-precondition", "Não foi possível identificar o e-mail da conta.");
  }

  const valorArredondado = Number(valor.toFixed(2));

  // Cria o registro da recarga como "pendente" antes de chamar o Mercado Pago,
  // para o webhook conseguir localizá-lo pelo external_reference.
  const recargaRef = await db.collection("recargas").add({
    uid,
    valor: valorArredondado,
    status: "pendente",
    metodo: "pix",
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  });

  const corpo = {
    transaction_amount: valorArredondado,
    description: "Recarga de saldo - Viralizar",
    payment_method_id: "pix",
    payer: { email: email },
    external_reference: recargaRef.id,
    notification_url: FUNCOES_URL + "/webhookMercadoPago"
  };

  const resp = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + MP_ACCESS_TOKEN.value(),
      "X-Idempotency-Key": recargaRef.id
    },
    body: JSON.stringify(corpo)
  });

  if (!resp.ok) {
    const detalhe = await resp.text();
    console.error("Mercado Pago respondeu erro ao criar pagamento Pix:", resp.status, detalhe);
    await recargaRef.update({ status: "erro" });
    throw new HttpsError("internal", "Não foi possível gerar o Pix. Tente novamente.");
  }

  const pagamento = await resp.json();
  const dadosPix = pagamento.point_of_interaction && pagamento.point_of_interaction.transaction_data;

  if (!dadosPix || !dadosPix.qr_code) {
    console.error("Mercado Pago não retornou QR code Pix:", JSON.stringify(pagamento));
    await recargaRef.update({ status: "erro" });
    throw new HttpsError("internal", "Não foi possível gerar o QR code. Tente novamente.");
  }

  await recargaRef.update({ mercadopagoPaymentId: String(pagamento.id) });

  return {
    recargaId: recargaRef.id,
    qrCode: dadosPix.qr_code,
    qrCodeBase64: dadosPix.qr_code_base64,
    expiraEm: pagamento.date_of_expiration || null
  };
});

// ---------- Webhook do Mercado Pago: confirma pagamento e credita o saldo ----------
exports.webhookMercadoPago = onRequest({ secrets: [MP_ACCESS_TOKEN], timeoutSeconds: 60 }, async (req, res) => {
  try {
    const corpo = req.body || {};
    const tipo = corpo.type || req.query.type || req.query.topic;
    const paymentId = (corpo.data && corpo.data.id) || req.query.id || req.query["data.id"];

    if (tipo !== "payment" || !paymentId) {
      res.status(200).send("ignorado");
      return;
    }

    // Nunca confia no status vindo da notificação: confirma direto na API do
    // Mercado Pago, usando nossa própria credencial, antes de creditar qualquer saldo.
    const respPagamento = await fetch("https://api.mercadopago.com/v1/payments/" + paymentId, {
      headers: { Authorization: "Bearer " + MP_ACCESS_TOKEN.value() }
    });

    if (!respPagamento.ok) {
      console.error("Mercado Pago: não foi possível consultar o pagamento", paymentId, respPagamento.status);
      res.status(200).send("pagamento nao encontrado");
      return;
    }

    const pagamento = await respPagamento.json();

    if (pagamento.status !== "approved") {
      res.status(200).send("nao aprovado");
      return;
    }

    const recargaId = pagamento.external_reference;
    if (!recargaId) {
      res.status(200).send("sem referencia");
      return;
    }

    const recargaRef = db.collection("recargas").doc(recargaId);

    await db.runTransaction(async (tx) => {
      const recargaSnap = await tx.get(recargaRef);
      if (!recargaSnap.exists) return;

      const recarga = recargaSnap.data();
      if (recarga.status === "creditado") return; // já processado (webhook pode repetir)

      const usuarioRef = db.collection("users").doc(recarga.uid);
      tx.update(usuarioRef, { saldo: admin.firestore.FieldValue.increment(recarga.valor) });
      tx.update(recargaRef, {
        status: "creditado",
        mercadopagoPaymentId: String(paymentId),
        creditadoEm: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.status(200).send("ok");
  } catch (erro) {
    console.error("Erro no webhook do Mercado Pago:", erro);
    res.status(500).send("erro interno");
  }
});
