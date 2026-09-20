let usuarioAtual = null;
let servicosCache = [];

// Escapa valores antes de inserir em innerHTML.
// Nome/categoria de serviço (vindos do provedor externo)
// e o link informado pelo próprio usuário não são confiáveis.
// Sem isso, podem permitir XSS armazenado.
function escapeHtml(valor) {
    var texto = String(
        valor === null || valor === undefined ? '' : valor
    );

    var mapa = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };

    return texto.replace(/[&<>"']/g, function (c) {
        return mapa[c];
    });
}


// ==============================
// AUTENTICAÇÃO
// ==============================

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    usuarioAtual = user;

    // Saldo e serviços são independentes um do outro, então buscamos os
    // dois ao mesmo tempo em vez de esperar um terminar para começar o
    // outro — isso evita que o primeiro login pareça travado.
    await Promise.all([
        carregarSaldo(),
        carregarServicos()
    ]);

    escutarPedidos();
});


// ==============================
// SALDO
// ==============================

async function carregarSaldo() {
    const doc = await db
        .collection('users')
        .doc(usuarioAtual.uid)
        .get();

    const saldo =
        (doc.data() && doc.data().saldo) || 0;

    document.getElementById('saldo-lateral').textContent =
        formatarMoeda(saldo);
}


// ==============================
// SERVIÇOS — CATEGORIAS POR REDE SOCIAL
// ==============================

// Os serviços vêm de um provedor externo com um campo "categoria" que é,
// na prática, texto de marketing solto — não uma taxonomia confiável de
// redes sociais. Por isso a classificação por rede é feita aqui, no
// front-end, procurando palavras-chave no nome e na categoria de cada
// serviço. A ordem da lista importa: a primeira rede cujo termo bater é
// usada, e quem não bater com nada cai em "Outros".
const redesConfig = [
    { chave: 'instagram', rotulo: 'Instagram', termos: ['instagram', 'insta', 'ig '] },
    { chave: 'tiktok', rotulo: 'TikTok', termos: ['tiktok', 'tik tok', 'tikt', 'ttk'] },
    { chave: 'facebook', rotulo: 'Facebook', termos: ['facebook', 'face'] },
    { chave: 'youtube', rotulo: 'YouTube', termos: ['youtube', 'yt '] },
    { chave: 'twitter_x', rotulo: 'X (Twitter)', termos: ['twitter'] },
    { chave: 'kwai', rotulo: 'Kwai', termos: ['kwai'] },
    { chave: 'twitch', rotulo: 'Twitch', termos: ['twitch'] },
    { chave: 'telegram', rotulo: 'Telegram', termos: ['telegram', 'tele '] },
    { chave: 'threads', rotulo: 'Threads', termos: ['threads'] },
    { chave: 'discord', rotulo: 'Discord', termos: ['discord'] },
    { chave: 'shopee', rotulo: 'Shopee', termos: ['shopee'] },
    { chave: 'outros', rotulo: 'Outros', termos: [] }
];

// Sinais fracos: só usados quando nenhuma rede bateu pelos termos fortes
// acima. Isso evita que, por exemplo, um serviço de "reels" do Facebook
// (que já bate no termo forte "facebook") seja roubado pelo Instagram só
// por causa da palavra "reels".
const redesFallback = [
    { chave: 'instagram', termos: ['reels', 'igtv'] }
];

// Alguns serviços do provedor são apenas placeholders internos quebrados
// ou desatualizados e nunca deveriam aparecer para o cliente.
function ehLixo(servico) {
    const nome = (servico.nome || '').toLowerCase();
    const categoria = (servico.categoria || '').toLowerCase();

    return (
        nome.indexOf('não use') !== -1 ||
        nome.indexOf('nao use') !== -1 ||
        nome.indexOf('interno') !== -1 ||
        (categoria.indexOf('desatualizado') !== -1 && categoria.indexOf('lentos') !== -1)
    );
}

// Classifica um serviço em uma rede social a partir do nome e da categoria.
function detectarRede(servico) {
    const texto = (
        (servico.nome || '') + ' ' + (servico.categoria || '')
    ).toLowerCase();

    for (let i = 0; i < redesConfig.length; i++) {
        const rede = redesConfig[i];

        if (rede.chave === 'outros') continue;

        for (let j = 0; j < rede.termos.length; j++) {
            if (texto.indexOf(rede.termos[j]) !== -1) {
                return rede.chave;
            }
        }
    }

    for (let i = 0; i < redesFallback.length; i++) {
        const rede = redesFallback[i];

        for (let j = 0; j < rede.termos.length; j++) {
            if (texto.indexOf(rede.termos[j]) !== -1) {
                return rede.chave;
            }
        }
    }

    return 'outros';
}

async function carregarServicos() {
    // Mostra uma mensagem de carregamento no lugar dos cartões enquanto
    // a busca no Firestore não termina, para a tela não parecer vazia
    // ou travada no primeiro login.
    document.getElementById('grade-redes').innerHTML =
        '<p class="vazio">Carregando serviços…</p>';

    const snap = await db
        .collection('services')
        .where('ativo', '==', true)
        .get();

    servicosCache = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => !ehLixo(s));

    servicosCache.forEach(s => {
        s.rede = detectarRede(s);
    });

    renderizarCategorias();

    document
        .getElementById('inp-qtd')
        .addEventListener(
            'input',
            atualizarDetalheServico
        );
}


// Monta os cartões de categoria (uma rede social por cartão), mostrando
// apenas as redes que realmente têm serviços disponíveis no momento.
function renderizarCategorias() {
    const grade =
        document.getElementById('grade-redes');

    const contagens = {};

    servicosCache.forEach(s => {
        contagens[s.rede] = (contagens[s.rede] || 0) + 1;
    });

    const redesComServicos = redesConfig.filter(
        r => contagens[r.chave] > 0
    );

    grade.innerHTML = redesComServicos
        .map(r =>
            '<div class="cartao cartao-clicavel" onclick="selecionarRede(\'' + r.chave + '\')">' +
                '<div class="rotulo">' + escapeHtml(r.rotulo) + '</div>' +
                '<div class="valor">' + contagens[r.chave] + '</div>' +
                '<div class="rotulo">serviço' + (contagens[r.chave] === 1 ? '' : 's') + '</div>' +
            '</div>'
        )
        .join('');
}


// Abre a lista de serviços de uma rede social específica, preenchendo o
// formulário de pedido apenas com os serviços daquela categoria.
function selecionarRede(chave) {
    const servicosDaRede =
        servicosCache.filter(s => s.rede === chave);

    const sel =
        document.getElementById('sel-servico');

    sel.innerHTML = servicosDaRede
        .map(s =>
            '<option value="' + escapeHtml(s.id) + '">' +
            escapeHtml(s.nome) +
            '</option>'
        )
        .join('');

    sel.onchange = atualizarDetalheServico;

    document.getElementById('inp-qtd').value = '';

    atualizarDetalheServico();

    document.getElementById('pedido-categorias').style.display = 'none';
    document.getElementById('pedido-formulario').style.display = 'block';
}


// Volta da tela de serviços para a grade de categorias.
function voltarCategorias() {
    document.getElementById('pedido-formulario').style.display = 'none';
    document.getElementById('pedido-categorias').style.display = 'block';
}


function servicoSelecionado() {
    const id =
        document.getElementById('sel-servico').value;

    return servicosCache.find(
        s => s.id === id
    );
}


// ==============================
// DETALHES DO SERVIÇO
// ==============================

function atualizarDetalheServico() {
    const s = servicoSelecionado();

    const qtdInput =
        document.getElementById('inp-qtd');

    if (!s) return;

    qtdInput.min = s.min;
    qtdInput.max = s.max;

    if (!qtdInput.value) {
        qtdInput.value = s.min;
    }

    document.getElementById(
        'detalhe-servico'
    ).textContent =
        'Mínimo ' + s.min + ' · Máximo ' + s.max +
        ' · Preço de venda: ' + formatarMoeda(s.precoVenda) + ' por 1000';

    const qtd =
        Number(qtdInput.value || 0);

    const total =
        (qtd / 1000) * s.precoVenda;

    document.getElementById(
        'preco-estimado'
    ).textContent =
        formatarMoeda(total);
}


// ==============================
// CRIAR PEDIDO
// ==============================

async function criarPedido() {
    const erroEl =
        document.getElementById('erro-pedido');

    erroEl.textContent = '';

    const s =
        servicoSelecionado();

    const link =
        document
            .getElementById('inp-link')
            .value
            .trim();

    const quantidade =
        Number(
            document.getElementById('inp-qtd').value
        );


    // Verifica serviço
    if (!s) {
        erroEl.textContent =
            'Selecione um serviço.';
        return;
    }


    // Verifica link
    if (!link) {
        erroEl.textContent =
            'Informe o link.';
        return;
    }


    // Verifica se quantidade é inteiro
    if (!Number.isInteger(quantidade)) {
        erroEl.textContent =
            'Quantidade deve ser um número inteiro.';
        return;
    }


    // Verifica mínimo e máximo
    if (
        !quantidade ||
        quantidade < s.min ||
        quantidade > s.max
    ) {
        erroEl.textContent =
            'Quantidade deve estar entre ' + s.min + ' e ' + s.max + '.';

        return;
    }


    try {

        const criar =
            functions.httpsCallable(
                'criarPedido'
            );

        await criar({
            serviceId: s.id,
            link,
            quantidade
        });


        // Limpa o link depois do pedido
        document.getElementById(
            'inp-link'
        ).value = '';


        // Atualiza saldo
        await carregarSaldo();


        // Abre histórico de pedidos
        mostrarSecao('pedidos');


    } catch (err) {

        console.error(
            'Erro ao criar pedido:',
            err
        );

        erroEl.textContent =
            err.message ||
            'Não foi possível criar o pedido.';
    }
}


// ==============================
// RECARGA DE SALDO (PIX)
// ==============================

// Cancela a inscrição ativa no status da recarga atual (se houver).
let cancelarEscutaRecarga = null;

// Gera um pagamento Pix via backend e exibe o QR code diretamente nesta
// página, sem redirecionar o cliente. O saldo é creditado automaticamente
// assim que o webhook do Mercado Pago confirmar o pagamento — o status é
// acompanhado em tempo real por escutarRecarga().
async function gerarPagamentoPix() {
    const erroEl = document.getElementById('erro-recarga');
    const msgEl = document.getElementById('msg-recarga');

    erroEl.textContent = '';

    const valor = Number(
        document.getElementById('inp-valor-recarga').value
    );

    if (!valor || valor < 5) {
        erroEl.textContent = 'Informe um valor de pelo menos R$ 5,00.';
        return;
    }

    const botao = document.querySelector('#recarga-formulario button');

    if (botao) {
        botao.disabled = true;
        botao.textContent = 'Gerando QR code…';
    }

    try {
        const criarPix = functions.httpsCallable('criarPagamentoPix');

        const resp = await criarPix({ valor });

        const dados = resp.data;

        document.getElementById('pix-qrcode-img').src =
            'data:image/png;base64,' + dados.qrCodeBase64;

        document.getElementById('pix-copia-cola').value =
            dados.qrCode;

        if (msgEl) {
            msgEl.textContent = 'Aguardando confirmação do pagamento…';
        }

        document.getElementById('recarga-formulario').style.display = 'none';
        document.getElementById('recarga-pix').style.display = 'block';

        escutarRecarga(dados.recargaId);

    } catch (err) {
        console.error('Erro ao gerar pagamento Pix:', err);
        erroEl.textContent =
            err.message || 'Não foi possível gerar o QR code. Tente novamente.';
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.textContent = 'Gerar QR Code Pix';
        }
    }
}

// Observa em tempo real o documento da recarga no Firestore: assim que o
// webhook do Mercado Pago confirmar o pagamento e creditar o saldo, o
// campo "status" muda para "creditado" e a tela é atualizada sozinha,
// sem precisar recarregar a página.
function escutarRecarga(recargaId) {
    if (cancelarEscutaRecarga) {
        cancelarEscutaRecarga();
        cancelarEscutaRecarga = null;
    }

    const msgEl = document.getElementById('msg-recarga');

    cancelarEscutaRecarga = db
        .collection('recargas')
        .doc(recargaId)
        .onSnapshot(
            async snap => {
                const dados = snap.data();

                if (!dados) return;

                if (dados.status === 'creditado') {
                    if (msgEl) {
                        msgEl.textContent =
                            'Pagamento confirmado! Saldo atualizado.';
                    }

                    await carregarSaldo();

                } else if (dados.status === 'erro') {
                    if (msgEl) {
                        msgEl.textContent =
                            'Houve um erro com este pagamento. Gere um novo QR code.';
                    }
                }
            },
            error => {
                console.error('Erro ao acompanhar recarga:', error);
            }
        );
}

// Copia o código Pix (copia e cola) para a área de transferência do usuário.
function copiarCodigoPix() {
    const campo = document.getElementById('pix-copia-cola');
    const msgEl = document.getElementById('msg-recarga');

    campo.select();

    const mostrarCopiado = function () {
        if (!msgEl) return;

        const mensagemAnterior = msgEl.textContent;
        msgEl.textContent = 'Código copiado!';

        setTimeout(function () {
            msgEl.textContent = mensagemAnterior;
        }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(campo.value)
            .then(mostrarCopiado)
            .catch(function () {
                document.execCommand('copy');
                mostrarCopiado();
            });
    } else {
        document.execCommand('copy');
        mostrarCopiado();
    }
}

// Cancela a recarga em andamento e volta ao formulário, permitindo gerar
// um novo QR code (por exemplo, se o anterior expirou).
function cancelarRecargaPix() {
    if (cancelarEscutaRecarga) {
        cancelarEscutaRecarga();
        cancelarEscutaRecarga = null;
    }

    document.getElementById('pix-qrcode-img').src = '';
    document.getElementById('pix-copia-cola').value = '';
    document.getElementById('inp-valor-recarga').value = '';

    const msgEl = document.getElementById('msg-recarga');

    if (msgEl) {
        msgEl.textContent = '';
    }

    document.getElementById('recarga-pix').style.display = 'none';
    document.getElementById('recarga-formulario').style.display = 'block';
}


// ==============================
// ESCUTAR PEDIDOS
// ==============================

function escutarPedidos() {

    db.collection('orders')

        .where(
            'uid',
            '==',
            usuarioAtual.uid
        )

        .orderBy(
            'criadoEm',
            'desc'
        )

        .onSnapshot(
            snap => {

                const corpo =
                    document.getElementById(
                        'corpo-pedidos'
                    );

                const vazio =
                    document.getElementById(
                        'pedidos-vazio'
                    );


                if (snap.empty) {

                    corpo.innerHTML = '';

                    vazio.style.display =
                        'block';

                    return;
                }


                vazio.style.display =
                    'none';


                corpo.innerHTML =
                    snap.docs
                        .map(d => {

                            const p =
                                d.data();

                            const data =
                                p.criadoEm
                                    ? p.criadoEm
                                        .toDate()
                                        .toLocaleDateString(
                                            'pt-BR'
                                        )
                                    : '—';


                            return (
                                '<tr>' +

                                    '<td>' +
                                        escapeHtml(p.servicoNome || '—') +
                                    '</td>' +

                                    '<td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
                                        escapeHtml(p.link || '') +
                                    '</td>' +

                                    '<td>' +
                                        escapeHtml(p.quantidade ?? '—') +
                                    '</td>' +

                                    '<td>' +
                                        formatarMoeda(p.valor) +
                                    '</td>' +

                                    '<td>' +
                                        rotuloStatus(p.status) +
                                    '</td>' +

                                    '<td>' +
                                        escapeHtml(data) +
                                    '</td>' +

                                '</tr>'
                            );
                        })
                        .join('');
            },

            error => {

                console.error(
                    'Erro ao carregar pedidos:',
                    error
                );
            }
        );
}


// ==============================
// STATUS
// ==============================

function rotuloStatus(status) {

    const mapa = {

        pendente: [
            'status-pendente',
            'Pendente'
        ],

        'in progress': [
            'status-progresso',
            'Em progresso'
        ],

        processing: [
            'status-progresso',
            'Processando'
        ],

        completed: [
            'status-completo',
            'Concluído'
        ],

        partial: [
            'status-progresso',
            'Parcial'
        ],

        canceled: [
            'status-erro',
            'Cancelado'
        ],

        erro: [
            'status-erro',
            'Erro'
        ]
    };


    const [classe, texto] =
        mapa[status] || [
            'status-pendente',
            status || 'Pendente'
        ];


    return (
        '<span class="rotulo-status ' + classe + '">' +
            escapeHtml(texto) +
        '</span>'
    );
}


// ==============================
// NAVEGAÇÃO
// ==============================

// ==============================
// MENU LATERAL (CELULAR)
// ==============================

function alternarMenu() {
    const lateral = document.getElementById('lateral');
    const backdrop = document.getElementById('menu-backdrop');

    const aberto = lateral.classList.toggle('aberta');

    if (backdrop) {
        backdrop.classList.toggle('visivel', aberto);
    }
}

function fecharMenu() {
    document.getElementById('lateral').classList.remove('aberta');

    const backdrop = document.getElementById('menu-backdrop');

    if (backdrop) {
        backdrop.classList.remove('visivel');
    }
}


function mostrarSecao(nome) {

    // No celular, o menu lateral fica aberto por cima do conteúdo até
    // o usuário escolher uma opção. Sem fechar aqui, a seção nova ficava
    // escondida atrás do próprio menu ainda aberto.
    fecharMenu();

    [
        'pedido',
        'pedidos',
        'saldo'
    ].forEach(s => {

        const secao =
            document.getElementById(
                'secao-' + s
            );

        if (secao) {

            secao.style.display =
                s === nome
                    ? 'block'
                    : 'none';
        }
    });


    const navItems =
        document.querySelectorAll(
            '.nav-item'
        );


    navItems.forEach(
        el =>
            el.classList.remove(
                'ativo'
            )
    );


    const alvo = {
        pedido: 0,
        pedidos: 1,
        saldo: 2
    }[nome];


    if (
        alvo !== undefined &&
        navItems[alvo]
    ) {

        navItems[alvo]
            .classList
            .add('ativo');
    }
}


// ==============================
// SAIR
// ==============================

function sair() {

    auth.signOut()
        .then(() => {

            window.location.href =
                'index.html';

        })
        .catch(error => {

            console.error(
                'Erro ao sair:',
                error
            );
        });
}


// ==============================
// FORMATAR MOEDA
// ==============================

function formatarMoeda(v) {

    const valor =
        Number(v) || 0;

    return valor.toLocaleString(
        'pt-BR',
        {
            style: 'currency',
            currency: 'BRL'
        }
    );
}
