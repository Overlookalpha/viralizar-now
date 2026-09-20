(() => {
  let convite = null;
  const modoApp = window.matchMedia('(display-mode: standalone)');
  const botoes = [...document.querySelectorAll('[data-install-app]')];
  const instalado = () => modoApp.matches || window.navigator.standalone === true;
  const atualizar = () => botoes.forEach((botao) => { botao.hidden = instalado(); });
  atualizar();
  modoApp.addEventListener?.('change', atualizar);

  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    convite = evento;
    atualizar();
  });
  window.addEventListener('appinstalled', () => {
    convite = null;
    botoes.forEach((botao) => { botao.hidden = true; });
    document.getElementById('dialogo-instalar')?.close();
  });

  function instrucoes() {
    let dialogo = document.getElementById('dialogo-instalar');
    if (!dialogo) {
      dialogo = document.createElement('dialog');
      dialogo.id = 'dialogo-instalar';
      dialogo.className = 'dialogo-instalar';
      dialogo.setAttribute('aria-labelledby', 'titulo-instalar');
      dialogo.innerHTML = '<h2 id="titulo-instalar">Viralizar no seu celular</h2>' +
        '<p>Adicione o app à tela inicial para abrir pelo ícone.</p>' +
        '<ol id="passos-instalar"></ol>' +
        '<p class="texto-ajuda">É necessário estar conectado à internet para entrar, consultar saldo e fazer pedidos.</p>' +
        '<form method="dialog"><button class="btn btn-primario btn-bloco" autofocus>Entendi</button></form>';
      document.body.appendChild(dialogo);
    }
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const embutido = /Instagram|FBAN|FBAV|; wv\)/i.test(ua);
    let passos;
    if (embutido) {
      passos = ['Abra este site no Safari (iPhone) ou no Chrome (Android), usando o menu do navegador atual.', 'Toque novamente em “Baixar app” no site.'];
    } else if (ios) {
      passos = ['Toque no botão Compartilhar do navegador. Se não encontrar a opção, abra este site no Safari.', 'Escolha “Adicionar à Tela de Início”. Se aparecer “Abrir como App da Web”, mantenha essa opção ativada.', 'Confirme em “Adicionar”. O ícone aparecerá na tela inicial.'];
    } else if (/Android/i.test(ua)) {
      passos = ['Abra o menu ⋮ do Chrome ou o menu do seu navegador.', 'Escolha “Instalar app” ou “Adicionar à tela inicial” e confirme.', 'Se a opção não aparecer, abra o site no Chrome atualizado e tente novamente.'];
    } else {
      passos = ['No Chrome ou Edge, procure o ícone de instalação na barra de endereço ou a opção de instalar no menu do navegador.', 'Para instalar no celular, abra este mesmo endereço nele e toque em “Baixar app”.'];
    }
    const lista = dialogo.querySelector('#passos-instalar');
    lista.replaceChildren(...passos.map((texto) => {
      const item = document.createElement('li'); item.textContent = texto; return item;
    }));
    if (!dialogo.open) dialogo.showModal();
  }

  botoes.forEach((botao) => botao.addEventListener('click', async () => {
    if (instalado()) { atualizar(); return; }
    if (!convite) { instrucoes(); return; }
    const evento = convite;
    convite = null;
    botoes.forEach((item) => { item.disabled = true; });
    try {
      await evento.prompt();
      await evento.userChoice;
      // Apenas appinstalled/modo standalone confirmam instalacao; cancelar
      // o convite nao esconde o botao nem inventa uma mensagem de sucesso.
    } catch {
      instrucoes();
    } finally {
      botoes.forEach((item) => { item.disabled = false; });
    }
  }));

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' })
      .catch((erro) => console.warn('Não foi possível preparar o modo app:', erro));
  }
})();
