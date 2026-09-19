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

    await carregarSaldo();
    await carregarServicos();

    escutarPedidos();

    verificarRetornoPagamento();
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
// SERVIÇOS
// ==============================

async function carregarServicos() {
    const snap = await db
        .collection('services')
        .where('ativo', '==', true)
        .get();

    servicosCache = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
    }));

    const sel =
        document.getElementById('sel-servico');

    sel.innerHTML = servicosCache
        .map(s =>
            `<option value="${escapeHtml(s.id)}">${escapeHtml(s.nome)} — ${escapeHtml(s.categoria)}</option>`
        )
        .join('');

    atualizarDetalheServico();

    sel.addEventListener(
        'change',
        atualizarDetalheServico
    );

    document
        .getElementById('inp-qtd')
        .addEventListener(
            'input',
            atualizarDetalheServico
        );
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
        `Mínimo ${s.min} · Máximo ${s.max} · Preço de venda: ${formatarMoeda(s.precoVenda)} por 1000`;

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


    // Verifica se quantidade é inteira
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
            `Quantidade deve estar entre ${s.min} e ${s.max}.`;

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
// RECARGA DE SALDO (MERCADO PAGO)
// ==============================

// Cria a preferência de pagamento no backend e redireciona o cliente para
// a página de checkout do Mercado Pago (Pix, cartão ou boleto). Nenhum
// dado de pagamento passa por este site.
async function iniciarRecarga() {
    const erroEl = document.getElementById('erro-recarga');
    const msgEl = document.getElementById('msg-recarga');

    erroEl.textContent = '';
    msgEl.textContent = '';

    const valor = Number(
        document.getElementById('inp-valor-recarga').value
    );

    if (!valor || valor < 5) {
        erroEl.textContent = 'Informe um valor de pelo menos R$ 5,00.';
        return;
    }

    msgEl.textContent = 'Preparando pagamento…';

    try {
        const criarPreferencia = functions.httpsCallable(
            'criarPreferenciaPagamento'
        );

        const resp = await criarPreferencia({ valor });

        window.location.href = resp.data.initPoint;

    } catch (err) {
        console.error('Erro ao iniciar recarga:', err);
        msgEl.textContent = '';
        erroEl.textContent =
            err.message || 'Não foi possível iniciar o pagamento.';
    }
}

// Ao voltar do checkout do Mercado Pago, a URL traz
// ?pagamento=sucesso|pendente|falha (definido em back_urls no backend).
// Mostra a mensagem correspondente e, se aprovado, aguarda o webhook
// creditar o saldo antes de atualizar a tela.
function verificarRetornoPagamento() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('pagamento');

    if (!status) return;

    mostrarSecao('saldo');

    const msgEl = document.getElementById('msg-recarga');

    if (status === 'sucesso') {
        msgEl.textContent = 'Pagamento aprovado! Atualizando seu saldo…';
        aguardarAtualizacaoSaldo();
    } else if (status === 'pendente') {
        msgEl.textContent =
            'Pagamento em análise. Assim que for aprovado, o saldo é creditado automaticamente.';
    } else if (status === 'falha') {
        msgEl.textContent =
            'O pagamento não foi concluído. Você pode tentar novamente.';
    }

    // Remove o parâmetro da URL sem recarregar a página.
    window.history.replaceState({}, document.title, window.location.pathname);
}

// O webhook do Mercado Pago credita o saldo de forma assíncrona (pode
// levar alguns segundos). Observa o saldo do usuário por até ~30s,
// mostrando a confirmação assim que ele aumentar.
function aguardarAtualizacaoSaldo() {
    const saldoInicial = extrairValorMoeda(
        document.getElementById('saldo-lateral').textContent
    );

    const msgEl = document.getElementById('msg-recarga');

    let tentativas = 0;

    const intervalo = setInterval(async () => {
        tentativas++;

        await carregarSaldo();

        const saldoAtual = extrairValorMoeda(
            document.getElementById('saldo-lateral').textContent
        );

        if (saldoAtual > saldoInicial) {
            clearInterval(intervalo);
            msgEl.textContent = 'Saldo atualizado com sucesso!';
        } else if (tentativas >= 15) {
            clearInterval(intervalo);
            msgEl.textContent =
                'O pagamento está sendo processado. Se o saldo não aparecer em alguns minutos, entre em contato com o suporte.';
        }
    }, 2000);
}

function extrairValorMoeda(texto) {
    return (
        Number(
            String(texto)
                .replace(/[^\d,-]/g, '')
                .replace(',', '.')
        ) || 0
    );
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


                            return `
                                <tr>

                                    <td>
                                        ${escapeHtml(
                                            p.servicoNome || '—'
                                        )}
                                    </td>

                                    <td
                                        style="
                                            max-width:220px;
                                            overflow:hidden;
                                            text-overflow:ellipsis;
                                            white-space:nowrap;
                                        "
                                    >
                                        ${escapeHtml(
                                            p.link || ''
                                        )}
                                    </td>

                                    <td>
                                        ${escapeHtml(
                                            p.quantidade ?? '—'
                                        )}
                                    </td>

                                    <td>
                                        ${formatarMoeda(
                                            p.valor
                                        )}
                                    </td>

                                    <td>
                                        ${rotuloStatus(
                                            p.status
                                        )}
                                    </td>

                                    <td>
                                        ${escapeHtml(data)}
                                    </td>

                                </tr>
                            `;
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


    return `
        <span class="rotulo-status ${classe}">
            ${escapeHtml(texto)}
        </span>
    `;
}


// ==============================
// NAVEGAÇÃO
// ==============================

function mostrarSecao(nome) {

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
