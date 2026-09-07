# Viralizar

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
