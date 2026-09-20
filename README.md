# Viralizar

## Login e aplicativo no celular

- “Esqueci minha senha” envia o link de redefinição pelo Firebase Authentication,
  no idioma português. A mensagem não revela se um e-mail tem cadastro.
- O botão de olho mostra/oculta a senha no login e no cadastro, sem enviar o formulário.
- “Baixar app” oferece a instalação PWA quando o navegador disponibiliza o convite.
  No iPhone ou sem convite, mostra instruções para adicionar à tela inicial.
  O usuário precisa confirmar a instalação; o site não pode criar um atalho sozinho.
- Manifesto, ícones e service worker usam caminhos relativos, compatíveis com
  `https://overlookalpha.github.io/viralizar-now/` e hospedagem na raiz de um domínio.
- É necessário HTTPS (ou localhost para desenvolvimento). O app exige internet
  para login, pedidos, saldo e pagamentos. Sem conexão, exibe uma página explicativa.
  O cache não guarda páginas da conta nem respostas do Firebase ou de pagamentos.
- A vitrine do login é ocultada em telas pequenas. As tabelas extensas rolam
  horizontalmente dentro de sua seção, sem alargar a página inteira.

### Verificação

Execute `npm install`, `npx playwright install chromium` e `npm test` para testar
login, recuperação de senha, instalação, layout em 320–1440 px e página offline.
Os testes usam um Firebase simulado: não criam contas, não enviam e-mails e não
acionam pagamentos reais. Também há uma verificação automática em pull requests.
Opcionalmente, defina `BROWSER_PATH` para usar um Chromium já instalado.

Depois de publicar, confira o recebimento do e-mail em uma conta de teste sua e
a instalação em Android/iPhone reais. O Firebase já deve ter e-mail/senha habilitado;
o link usa a tela padrão de redefinição hospedada pelo Firebase.

Observação de hospedagem: os arquivos web deste repositório estão na raiz.
O `firebase.json` existente aponta para `public/`; isso deve ser alinhado antes
de uma publicação pelo Firebase Hosting. Essa configuração não interfere no
GitHub Pages e não foi alterada nesta atualização.

Painel de revenda de serviços sociais (seguidores, curtidas, visualizações), integrado
com a API da Baratos Sociais e construído sobre Firebase.

## Estrutura

```
viralizar/
├── public/              → frontend (Hosting)
│   ├── index.html        login / cadastro
│   ├── painel.html        painel do usuário (novo pedido, histórico, saldo)
│   ├── admin.html         painel administrativo
│   ├── css/style.css
│   └── js/
│       ├── firebase-config.js   ⚠️ preencher com as chaves do seu projeto
│       ├── auth.js
│       ├── painel.js
│       └── admin.js
├── functions/           → Cloud Functions (integração com a Baratos Sociais)
│   └── index.js
├── firestore.rules
└── firebase.json
```

## Modelo de dados (Firestore)

- **users/{uid}** — `nome`, `email`, `saldo`, `isAdmin`, `criadoEm`
- **services/{id}** — `nome`, `categoria`, `precoCusto`, `margemPercentual`, `precoVenda`, `min`, `max`, `ativo`
- **orders/{id}** — `uid`, `serviceId`, `link`, `quantidade`, `valor`, `status`, `baratosOrderId`, `criadoEm`

## Passo a passo para colocar no ar

1. **Criar o projeto Firebase**
   - Acesse [console.firebase.google.com](https://console.firebase.google.com) → "Adicionar projeto"
   - Ative **Authentication** (método E-mail/senha), **Firestore Database** e **Functions** (exige plano Blaze, pois faz chamadas de saída para a API da Baratos Sociais)

2. **Preencher as chaves do frontend**
   - Em Configurações do projeto → Seus apps → Web, copie o objeto de config
   - Cole em `public/js/firebase-config.js`

3. **Guardar a chave da API da Baratos Sociais com segurança**
   - Pegue sua API key em baratosociais.com (área "API")
   - Rode: `firebase functions:secrets:set BARATOS_API_KEY` e cole a chave quando pedir
   - Ela nunca fica no código nem no frontend — só as Cloud Functions acessam

4. **Instalar dependências e testar localmente (opcional)**
   ```
   cd functions
   npm install
   cd ..
   firebase emulators:start
   ```

5. **Publicar**
   ```
   firebase deploy
   ```

6. **Criar o primeiro admin**
   - Cadastre-se normalmente pelo `index.html`
   - No Firestore, abra `users/{seu-uid}` e mude `isAdmin` para `true` manualmente
   - Recarregue — você cai direto no `admin.html`

7. **Sincronizar os serviços**
   - No painel admin → "Sincronizar agora": puxa o catálogo da Baratos Sociais
   - Serviços novos entram **desativados** com margem padrão de 30% — ajuste a margem e ative os que quiser vender

## O que falta plugar

- **Recarga de saldo**: o frontend já tem a aba "Adicionar saldo", mas nenhum gateway de pagamento
  está conectado ainda. Quando você escolher (Mercado Pago, Pagar.me, Stripe etc.), eu integro —
  a função ficaria parecida com `criarPedido`: webhook do gateway confirma o pagamento e credita
  `saldo` do usuário via Admin SDK.
- **E-mails transacionais** (confirmação de cadastro, pedido concluído) — dá pra usar Firebase
  Extensions ou uma função que dispara e-mail.
- **Página de detalhe/edição de usuário** no admin (hoje é só leitura).
