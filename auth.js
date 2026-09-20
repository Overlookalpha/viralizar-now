function mostrarAba(aba) {
  if (!['entrar', 'criar', 'recuperar'].includes(aba)) return;
  ['entrar', 'criar', 'recuperar'].forEach((nome) => {
    document.getElementById('form-' + nome).style.display = nome === aba ? 'block' : 'none';
  });
  document.getElementById('aba-entrar').classList.toggle('ativa', aba !== 'criar');
  document.getElementById('aba-criar').classList.toggle('ativa', aba === 'criar');
  document.querySelectorAll('[data-password-target]').forEach((botao) => definirVisibilidade(botao, false));
}

function definirVisibilidade(botao, visivel) {
  const campo = document.getElementById(botao.dataset.passwordTarget);
  campo.type = visivel ? 'text' : 'password';
  botao.setAttribute('aria-pressed', String(visivel));
  botao.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
  botao.title = visivel ? 'Ocultar senha' : 'Mostrar senha';
  botao.querySelector('[data-eye-slash]').toggleAttribute('hidden', !visivel);
}

document.querySelectorAll('[data-password-target]').forEach((botao) => {
  botao.addEventListener('click', () => definirVisibilidade(botao, botao.getAttribute('aria-pressed') !== 'true'));
});

document.getElementById('abrir-recuperacao').addEventListener('click', () => {
  const campo = document.getElementById('recuperar-email');
  campo.value = document.getElementById('login-email').value.trim();
  mostrarAba('recuperar');
  campo.focus();
});
document.getElementById('voltar-login').addEventListener('click', () => {
  document.getElementById('login-email').value = document.getElementById('recuperar-email').value.trim();
  mostrarAba('entrar');
  document.getElementById('login-senha').focus();
});

document.getElementById('form-recuperar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = document.getElementById('enviar-recuperacao');
  if (botao.disabled) return;
  const campo = document.getElementById('recuperar-email');
  campo.value = campo.value.trim();
  if (!campo.reportValidity()) return;
  const mensagem = document.getElementById('msg-recuperar');
  const sucesso = 'Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha. Confira também o spam.';
  mensagem.textContent = '';
  mensagem.classList.remove('erro');
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  try {
    auth.languageCode = 'pt-BR';
    // O Firebase hospeda a tela de redefinicao; nao precisamos de um dominio
    // de redirecionamento novo nem expomos se uma conta existe.
    await auth.sendPasswordResetEmail(campo.value);
    mensagem.textContent = sucesso;
  } catch (erro) {
    if (erro.code === 'auth/user-not-found') {
      mensagem.textContent = sucesso;
    } else {
      mensagem.classList.add('erro');
      mensagem.textContent = traduzErro(erro.code);
    }
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar link de recuperação';
  }
});

// Evita que o redirecionamento automatico dispare antes do documento do
// usuario ser criado no Firestore durante o cadastro (condicao de corrida:
// o onAuthStateChanged disparava assim que a conta era criada e navegava
// para painel.html antes do db.collection('users').doc(uid).set(...) terminar,
// cancelando a gravacao e deixando o usuario sem documento no Firestore).
let cadastrando = false;

// Se ja estiver logado, manda direto pro painel (ou admin)
auth.onAuthStateChanged(async (user) => {
  if (!user || cadastrando) return;
  try {
    const doc = await db.collection('users').doc(user.uid).get();
    const dados = doc.data();
    window.location.href = (dados && dados.isAdmin) ? 'admin.html' : 'painel.html';
  } catch (err) {
    // Antes, se essa consulta falhasse (ex: "client is offline" por causa de
    // proxy/VPN/extensao bloqueando a conexao do Firestore), o erro nao era
    // tratado: o login parecia "nao funcionar" sem nenhuma mensagem, mesmo
    // com e-mail/senha corretos e a autenticacao ja concluida com sucesso.
    console.error('Erro ao carregar dados do usuario apos login:', err);
    const erroEl = document.getElementById('erro-entrar');
    if (erroEl) {
      erroEl.textContent = 'Login feito, mas nao foi possivel conectar ao servidor. Verifique sua internet e tente novamente.';
    }
  }
});

document.getElementById('form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('erro-entrar');
  erroEl.textContent = '';
  try {
    await auth.signInWithEmailAndPassword(email, senha);
  } catch (err) {
    erroEl.textContent = traduzErro(err.code);
  }
});

document.getElementById('form-criar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('criar-nome').value;
  const email = document.getElementById('criar-email').value;
  const senha = document.getElementById('criar-senha').value;
  const erroEl = document.getElementById('erro-criar');
  erroEl.textContent = '';
  cadastrando = true;
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    await db.collection('users').doc(cred.user.uid).set({
      nome: nome,
      email: email,
      saldo: 0,
      isAdmin: false,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.location.href = 'painel.html';
  } catch (err) {
    cadastrando = false;
    erroEl.textContent = traduzErro(err.code);
  }
});

function traduzErro(codigo) {
  const mapa = {
    'auth/email-already-in-use': 'Este e-mail ja esta cadastrado.',
    'auth/invalid-email': 'E-mail invalido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.',
    'auth/network-request-failed': 'Não foi possível conectar. Confira sua internet e tente novamente.'
  };
  return mapa[codigo] || 'Nao foi possivel concluir. Tente novamente.';
}
