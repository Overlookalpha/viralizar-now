auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  const doc = await db.collection('users').doc(user.uid).get();
  if (!doc.data() || !doc.data().isAdmin) { window.location.href = 'painel.html'; return; }
  carregarVisaoGeral();
  escutarServicos();
  escutarTodosPedidos();
  escutarUsuarios();
  carregarSaldoProvedor();
});

async function carregarVisaoGeral() {
  const usuarios = await db.collection('users').get();
  document.getElementById('cartao-usuarios').textContent = usuarios.size;

  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
  const pedidosHoje = await db.collection('orders')
    .where('criadoEm', '>=', inicioHoje).get();
  document.getElementById('cartao-pedidos-hoje').textContent = pedidosHoje.size;

  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const pedidosMes = await db.collection('orders')
    .where('criadoEm', '>=', inicioMes).get();
  const total = pedidosMes.docs.reduce((soma, d) => soma + (d.data().valor || 0), 0);
  document.getElementById('cartao-faturamento').textContent = formatarMoeda(total);
}

async function carregarSaldoProvedor() {
  try {
    const consultar = functions.httpsCallable('consultarSaldoProvedor');
    const resp = await consultar();
    document.getElementById('saldo-provedor').textContent =
      `$${resp.data.balance} ${resp.data.currency}`;
  } catch (e) {
    document.getElementById('saldo-provedor').textContent = '—';
  }
}

async function sincronizarServicos() {
  const msg = document.getElementById('msg-sincronizar');
  msg.textContent = 'Sincronizando…';
  try {
    const sincronizar = functions.httpsCallable('sincronizarServicos');
    const resp = await sincronizar();
    msg.textContent = `${resp.data.total} serviços sincronizados.`;
  } catch (e) {
    msg.textContent = 'Erro ao sincronizar: ' + e.message;
  }
}

function escutarServicos() {
  db.collection('services').onSnapshot(snap => {
    document.getElementById('cartao-servicos').textContent =
      snap.docs.filter(d => d.data().ativo).length;
    document.getElementById('corpo-servicos').innerHTML = snap.docs.map(d => {
      const s = d.data();
      const margem = s.margemPercentual != null ? s.margemPercentual : 0;
      return `<tr>
        <td>${s.nome}</td>
        <td>${s.categoria || '—'}</td>
        <td>${formatarMoeda(s.precoCusto)}</td>
        <td>
          <input type="number" value="${margem}" style="width:70px; background:var(--tinta); color:var(--papel); border:1px solid var(--linha); border-radius:4px; padding:0.3rem;"
            onchange="atualizarMargem('${d.id}', this.value)"> %
        </td>
        <td>${formatarMoeda(s.precoVenda)}</td>
        <td><input type="checkbox" ${s.ativo ? 'checked' : ''} onchange="alternarAtivo('${d.id}', this.checked)"></td>
      </tr>`;
    }).join('');
  });
}

async function atualizarMargem(id, margem) {
  const margemNum = Number(margem);
  const doc = await db.collection('services').doc(id).get();
  const custo = doc.data().precoCusto;
  const precoVenda = custo * (1 + margemNum / 100);
  await db.collection('services').doc(id).update({
    margemPercentual: margemNum,
    precoVenda: Number(precoVenda.toFixed(2))
  });
}

async function alternarAtivo(id, ativo) {
  await db.collection('services').doc(id).update({ ativo });
}

function escutarTodosPedidos() {
  db.collection('orders').orderBy('criadoEm', 'desc').limit(200).onSnapshot(async snap => {
    const corpo = document.getElementById('corpo-todos-pedidos');
    corpo.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const data = p.criadoEm ? p.criadoEm.toDate().toLocaleDateString('pt-BR') : '—';
      return `<tr>
        <td>${p.usuarioEmail || p.uid}</td>
        <td>${p.servicoNome || '—'}</td>
        <td>${p.quantidade}</td>
        <td>${formatarMoeda(p.valor)}</td>
        <td>${p.status || 'pendente'}</td>
        <td>${data}</td>
      </tr>`;
    }).join('');
  });
}

function escutarUsuarios() {
  db.collection('users').orderBy('criadoEm', 'desc').onSnapshot(snap => {
    document.getElementById('corpo-usuarios').innerHTML = snap.docs.map(d => {
      const u = d.data();
      const data = u.criadoEm ? u.criadoEm.toDate().toLocaleDateString('pt-BR') : '—';
      return `<tr>
        <td>${u.nome || '—'}</td>
        <td>${u.email}</td>
        <td>${formatarMoeda(u.saldo)}</td>
        <td>${data}</td>
      </tr>`;
    }).join('');
  });
}

function mostrarSecao(nome) {
  ['visao', 'servicos', 'pedidos', 'usuarios'].forEach(s => {
    document.getElementById('secao-' + s).style.display = s === nome ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('ativo'));
  const alvo = { visao: 0, servicos: 1, pedidos: 2, usuarios: 3 }[nome];
  document.querySelectorAll('.nav-item')[alvo].classList.add('ativo');
}

function sair() { auth.signOut().then(() => window.location.href = 'index.html'); }

function formatarMoeda(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
