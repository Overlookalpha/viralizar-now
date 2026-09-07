const { onCall, HttpsError } = require("firebase-functions/v2/https");
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

// Margem padrão aplicada a serviços novos, até o admin ajustar manualmente
const MARGEM_PADRAO_PERCENTUAL = 30;

async function chamarBaratos(apiKey, params) {
  const corpo = new URLSearchParams({ key: apiKey, ...params });
  const resp = await fetch(BARATOS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo
  });
  if (!resp.ok) {
    throw new Error(`Baratos Sociais respondeu ${resp.status}`);
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
exports.sincronizarServicos = onCall({ secrets: [BARATOS_API_KEY] }, async (request) => {
  await exigirAdmin(request.auth && request.auth.uid);

  const servicos = await chamarBaratos(BARATOS_API_KEY.value(), { action: "services" });
  if (!Array.isArray(servicos)) {
    throw new HttpsError("internal", "Resposta inesperada da Baratos Sociais.");
  }

  const lote = db.batch();
  for (const s of servicos) {
    const ref = db.collection("services").doc(String(s.service));
    const existente = await ref.get();
    const custo = Number(s.rate);
    const margem = existente.exists
      ? (existente.data().margemPercentual ?? MARGEM_PADRAO_PERCENTUAL)
      : MARGEM_PADRAO_PERCENTUAL;

    lote.set(ref, {
      providerServiceId: String(s.service),
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
      ativo: existente.exists ? existente.data().ativo : false,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await lote.commit();

  return { total: servicos.length };
});

// ---------- Cria um pedido: debita saldo e envia à Baratos Sociais ----------
exports.criarPedido = onCall({ secrets: [BARATOS_API_KEY] }, async (request) => {
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
    if (quantidade < s.min || quantidade > s.max) {
      throw new HttpsError("invalid-argument", `Quantidade deve estar entre ${s.min} e ${s.max}.`);
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
exports.consultarSaldoProvedor = onCall({ secrets: [BARATOS_API_KEY] }, async (request) => {
  await exigirAdmin(request.auth && request.auth.uid);
  return chamarBaratos(BARATOS_API_KEY.value(), { action: "balance" });
});

// ---------- Sincroniza status dos pedidos em aberto (a cada 10 minutos) ----------
exports.sincronizarStatusPedidos = onSchedule(
  { schedule: "every 10 minutes", secrets: [BARATOS_API_KEY] },
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
