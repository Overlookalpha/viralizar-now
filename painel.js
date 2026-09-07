let usuarioAtual = null;
let servicosCache = [];

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  usuarioAtual = user;
  await carregarSaldo();
  await carregarServicos();
  escutarPedidos();
});

async function carregarSaldo() {
  const doc = await db.collection('users').doc(usuarioAtual.uid).get();
  const saldo = (doc.data() && doc.data().saldo) || 0;
  document.getElementById('saldo-lateral').textContent = formatarMoeda(saldo);
}

async function carregarServicos() {
  const snap = await db.collection('services').where('ativo', '==', true).get();
  servicosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sel = document.getElementById('sel-servico');
  sel.innerHTML = servicosCache.map(s =>
    `<option value="${s.id}">${s.nome} — ${s.categoria}</option>`
  ).join('');
  atualizarDetalheServico();
  sel.addEventListener('change', atualizarDetalheServico);
  document.getElementById('inp-qtd').addEventListener('input', atualizarDetalheServico);
}

function servicoSelecionado() {
  const id = document.getElementById('sel-servico').value;
  return servicosCache.find(s => s.id === id);
}

function atualizarDetalheServico() {
  const s = servicoSelecionado();
  const qtdInput = document.getElementById('inp-qtd');
  if (!s) return;
  qtdInput.min = s.min;
  qtdInput.max = s.max;
  if (!qtdInput.value) qtdInput.value = s.min;
  document.getElementById('detalhe-servico').textContent =
    `Mínimo ${s.min} · Máximo ${s.max} · Preço de venda: ${formatarMoeda(s.precoVenda)} por 1000`;
  const qtd = Number(qtdInput.value || 0);
  const total = (qtd / 1000) * s.precoVenda;
  document.getElementById('preco-estimado').textContent = formatarMoeda(total);
}

async function criarPedido() {
  const erroEl = document.getElementById('erro-pedido');
  erroEl.textContent = '';
  const s = servicoSelecionado();
  const link = document.getElementById('inp-link').value.trim();
  const quantidade = Number(document.getElementById('inp-qtd').value);

  if (!s) { erroEl.textContent = 'Selecione um serviço.'; return; }
  if (!link) { erroEl.textContent = 'Informe o link.'; return; }
  if (!quantidade || quantidade < s.min || quantidade > s.max) {
    erroEl.textContent = `Quantidade deve estar entre ${s.min} e ${s.max}.`;
    return;
  }

  try {
    const criar = functions.httpsCallable('criarPedido');
    await criar({ serviceId: s.id, link, quantidade });
    document.getElementById('inp-link').value = '';
    await carregarSaldo();
    mostrarSecao('pedidos');
  } catch (err) {
    erroEl.textContent = err.message || 'Não foi possível criar o pedido.';
  }
}

function escutarPedidos() {
  db.collection('orders')
    .where('uid', '==', usuarioAtual.uid)
    .orderBy('criadoEm', 'desc')
    .onSnapshot(snap => {
      const corpo = document.getElementById('corpo-pedidos');
      const vazio = document.getElementById('pedidos-vazio');
      if (snap.empty) {
        corpo.innerHTML = '';
        vazio.style.display = 'block';
        return;
      }
      vazio.style.display = 'none';
      corpo.innerHTML = snap.docs.map(d => {
        const p = d.data();
        const data = p.criadoEm ? p.criadoEm.toDate().toLocaleDateString('pt-BR') : '—';
        return `<tr>
          <td>${p.servicoNome || '—'}</td>
          <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.link}</td>
          <td>${p.quantidade}</td>
          <td>${formatarMoeda(p.valor)}</td>
          <td>${rotuloStatus(p.status)}</td>
          <td>${data}</td>
        </tr>`;
      }).join('');
    });
}

function rotuloStatus(status) {
  const mapa = {
    pendente: ['status-pendente', 'Pendente'],
    'in progress': ['status-progresso', 'Em progresso'],
    processing: ['status-progresso', 'Processando'],
    completed: ['status-completo', 'Concluído'],
    partial: ['status-progresso', 'Parcial'],
    canceled: ['status-erro', 'Cancelado'],
    erro: ['status-erro', 'Erro']
  };
  const [classe, texto] = mapa[status] || ['status-pendente', status || 'Pendente'];
  return `<span class="rotulo-status ${classe}">${texto}</span>`;
}

function mostrarSecao(nome) {
  ['pedido', 'pedidos', 'saldo'].forEach(s => {
    document.getElementById('secao-' + s).style.display = s === nome ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('ativo'));
  const alvo = { pedido: 0, pedidos: 1, saldo: 2 }[nome];
  document.querySelectorAll('.nav-item')[alvo].classList.add('ativo');
}

function sair() { auth.signOut().then(() => window.location.href = 'index.html'); }

function formatarMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
