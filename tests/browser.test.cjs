const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
let server, browser, origin;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let filename = decodeURIComponent(url.pathname).replace(/^\/viralizar-now\//, '').replace(/^\//, '') || 'index.html';
    const file = path.resolve(root, filename);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function pageFor(options = {}) {
  const context = await browser.newContext(options);
  await context.route('https://**/*', (route) => route.fulfill({ body: '', contentType: 'application/javascript' }));
  // No production authentication, email or payment requests are made by tests.
  await context.route('**/firebase-config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    window.resetCalls=[]; window.resetFailure=null; window.resetDelay=0;
    const auth={onAuthStateChanged(){}, async signInWithEmailAndPassword(){},
      async sendPasswordResetEmail(email){resetCalls.push(email);await new Promise(r=>setTimeout(r,resetDelay));if(resetFailure)throw {code:resetFailure};}};
    const db={}; const functions={httpsCallable:()=>async()=>({data:{}})};
  ` }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/viralizar-now/index.html');
  return { context, page, errors };
}

test('password eyes preserve values, never submit, and hide again on tab change', async () => {
  const {context,page,errors}=await pageFor();
  await page.locator('#login-senha').fill('senha-teste');
  await page.getByRole('button',{name:'Mostrar senha',exact:true}).click();
  assert.equal(await page.locator('#login-senha').getAttribute('type'),'text');
  assert.equal(await page.locator('#login-senha').inputValue(),'senha-teste');
  await page.getByRole('button',{name:'Ocultar senha',exact:true}).click();
  assert.equal(await page.locator('#login-senha').getAttribute('type'),'password');
  await page.locator('#aba-criar').click();
  await page.locator('#criar-senha').fill('outra-senha');
  await page.getByRole('button',{name:'Mostrar senha',exact:true}).click();
  assert.equal(await page.locator('#criar-senha').getAttribute('type'),'text');
  await page.locator('#aba-entrar').click();
  assert.equal(await page.locator('#criar-senha').getAttribute('type'),'password');
  assert.deepEqual(errors,[]); await context.close();
});

test('reset validates email, handles success/unknown account/network/throttle and prevents duplicate requests', async () => {
  const {context,page,errors}=await pageFor();
  await page.locator('#login-email').fill('cliente@example.com');
  await page.locator('#abrir-recuperacao').click();
  assert.equal(await page.locator('#recuperar-email').inputValue(),'cliente@example.com');
  await page.locator('#recuperar-email').fill('invalido');
  await page.locator('#enviar-recuperacao').click();
  assert.equal(await page.evaluate(()=>resetCalls.length),0);
  await page.locator('#recuperar-email').fill('cliente@example.com');
  await page.evaluate(()=>{ resetDelay=300; });
  await page.locator('#enviar-recuperacao').click();
  assert.equal(await page.locator('#enviar-recuperacao').isDisabled(),true);
  await page.evaluate(()=>document.getElementById('form-recuperar').dispatchEvent(new Event('submit',{cancelable:true})));
  await page.waitForFunction(()=>!document.getElementById('enviar-recuperacao').disabled);
  assert.equal(await page.evaluate(()=>resetCalls.length),1);
  const success=await page.locator('#msg-recuperar').textContent();
  assert.match(success,/Se este e-mail estiver cadastrado/);
  for (const [code,expected] of [['auth/user-not-found',/Se este e-mail/],['auth/network-request-failed',/internet/],['auth/too-many-requests',/Muitas tentativas/]]) {
    await page.evaluate(code=>{resetFailure=code;resetDelay=0;},code);
    await page.locator('#enviar-recuperacao').click();
    await page.waitForFunction(()=>!document.getElementById('enviar-recuperacao').disabled);
    assert.match(await page.locator('#msg-recuperar').textContent(),expected);
  }
  await page.locator('#voltar-login').click();
  assert.equal(await page.locator('#login-email').inputValue(),'cliente@example.com');
  assert.equal(await page.locator('#form-entrar').isVisible(),true);
  assert.deepEqual(errors,[]); await context.close();
});

test('login and all customer/admin sections fit mobile and desktop widths; tables scroll inside their container', async () => {
  const {context,page,errors}=await pageFor();
  for (const width of [320,375,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto(origin+'/viralizar-now/index.html');
    for (const tab of ['entrar','criar','recuperar']) {
      await page.evaluate(tab=>mostrarAba(tab),tab);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`login ${tab} ${width}`);
    }
    if(width<=860) assert.equal(await page.locator('.auth-vitrine').isVisible(),false);
    for(const file of ['painel.html','admin.html']) {
      await page.goto(origin+'/viralizar-now/'+file);
      await page.evaluate(()=>{
        document.querySelectorAll('section').forEach(s=>s.style.display='block');
        document.querySelectorAll('tbody').forEach(body=>{body.innerHTML='<tr>'+('<td>'+('ConteudoLongo'.repeat(8))+'</td>').repeat(6)+'</tr>';});
      });
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${file} ${width}`);
    }
  }
  assert.deepEqual(errors,[]); await context.close();
});

test('install prompt is triggered only on click, cancellation allows retry, appinstalled hides buttons', async () => {
  const {context,page,errors}=await pageFor();
  await page.evaluate(()=>{
    window.promptCalls=0;
    const e=new Event('beforeinstallprompt',{cancelable:true});
    e.prompt=async()=>{promptCalls++}; e.userChoice=Promise.resolve({outcome:'dismissed'});
    window.dispatchEvent(e);
  });
  assert.equal(await page.evaluate(()=>promptCalls),0);
  await page.locator('[data-install-app]').click();
  assert.equal(await page.evaluate(()=>promptCalls),1);
  assert.equal(await page.locator('[data-install-app]').isVisible(),true);
  await page.locator('[data-install-app]').click();
  assert.equal(await page.locator('#dialogo-instalar').isVisible(),true);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  assert.equal(await page.locator('[data-install-app]').isVisible(),false);
  assert.deepEqual(errors,[]); await context.close();
});

test('iPhone gets home-screen instructions; standalone app hides install button', async () => {
  const {context,page}=await pageFor({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  await page.locator('[data-install-app]').click();
  assert.match(await page.locator('#passos-instalar').textContent(),/Compartilhar.*Adicionar à Tela de Início/s);
  await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{get:()=>true}));
  await page.reload();
  assert.equal(await page.locator('[data-install-app]').isVisible(),false);
  await context.close();
});

test('manifest/icons and offline worker work under GitHub Pages subpath without caching account pages', async () => {
  const {context,page}=await pageFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  const result=await page.evaluate(async()=>{
    const manifest=await (await fetch('manifest.webmanifest')).json();
    const sizes=[];
    for(const icon of manifest.icons){ const blob=await (await fetch(icon.src)).blob(); const image=await createImageBitmap(blob); sizes.push(`${image.width}x${image.height}`); }
    return {manifest,sizes,scope:(await navigator.serviceWorker.ready).scope};
  });
  assert.equal(result.manifest.display,'standalone');
  assert.equal(result.manifest.start_url,'./index.html');
  assert.deepEqual(result.sizes,['192x192','512x512','512x512']);
  assert.equal(result.scope,origin+'/viralizar-now/');
  await context.setOffline(true);
  await page.goto(origin+'/viralizar-now/painel.html');
  assert.match(await page.locator('h1').textContent(),/sem conexão/);
  const cached=await page.evaluate(async()=>{
    const all=[]; for(const key of await caches.keys()) for(const req of await (await caches.open(key)).keys()) all.push(req.url); return all;
  });
  assert.equal(cached.some(url=>/firebase|auth\.js|painel\.html|admin\.html/.test(url)),false);
  await context.setOffline(false);
  await page.getByRole('link',{name:'Tentar novamente'}).click();
  assert.equal(await page.locator('#form-entrar').isVisible(),true);
  await context.close();
});
