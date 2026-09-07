function mostrarAba(aba) {
  const eEntrar = aba === 'entrar';
  document.getElementById('aba-entrar').classList.toggle('ativa', eEntrar);
  document.getElementById('aba-criar').classList.toggle('ativa', !eEntrar);
  document.getElementById('form-entrar').style.display = eEntrar ? 'block' : 'none';
  document.getElementById('form-criar').style.display = eEntrar ? 'none' : 'block';
}

// Se já estiver logado, manda direto pro painel (ou admin)
auth.onAuthStateChanged(async (user) => {
  if (!user) return;
  const doc = await db.collection('users').doc(user.uid).get();
  const dados = doc.data();
  window.location.href = (dados && dados.isAdmin) ? 'admin.html' : 'painel.html';
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
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    await db.collection('users').doc(cred.user.uid).set({
      nome: nome,
      email: email,
      saldo: 0,
      isAdmin: false,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    erroEl.textContent = traduzErro(err.code);
  }
});

function traduzErro(codigo) {
  const mapa = {
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.'
  };
  return mapa[codigo] || 'Não foi possível concluir. Tente novamente.';
}
