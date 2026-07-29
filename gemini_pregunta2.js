const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) { console.log('ERROR: Gemini no abierto'); await browser.close(); return; }

  await page.bringToFront();
  await page.waitForTimeout(2000);

  let input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) input = await page.$('[contenteditable="true"]');
  if (!input) { console.log('ERROR: No input'); await browser.close(); return; }

  await input.click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);

  const msg = `Gracias por tu analisis. Me gusta Baileys para WhatsApp.

Pero mi jefe (el duenio del negocio) quiere que el CHATBOT IA use Playwright + Opera GX + Gemini Web, no la API de Gemini (porque en Venezuela a veces bloquea la API y el ya tiene Opera GX logueado en Gemini).

ARQUITECTURA QUE QUIERO:
- WhatsApp: Baileys (estable, sin QR, sin Chromium)
- IA/Brain: Playwright conectado a Opera GX (CDP) que habla con Gemini Web
- Todo dentro del Main Process de Electron

PREGUNTAS CONCRETAS:
1. Como integro Baileys en Electron Main Process? (require, npm package?)
2. Baileys necesita Chromium/Puppeteer o es solo Node.js puro?
3. Como hacer que Playwright se conecte a Opera GX desde Electron? Opera ya corre aparte con --remote-debugging-port=9222
4. El flujo: cliente escribe en WhatsApp → Baileys recibe → Playwright pega en Gemini Web → Gemini responde → Playwright lee respuesta → Baileys la envia
   - Como manejar MULTIPLES clientes conversando al mismo tiempo?
   - Como mantener contexto de cada conversacion?
5. Como sincronizar catalogo, stock y precios del POS con el chatbot?
   - Cada X tiempo generar un resumen y pegarlo en Gemini como contexto?
   - O mejor inyectar el contexto en cada mensaje a Gemini?
6. Dame estructura de carpetas/archivos para implementar esto en el proyecto actual

CODIGO CONCRETO por favor, especialmente la integracion Baileys + Playwright.`;

  await page.keyboard.type(msg, { delay: 2 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  console.log('✓ Pregunta 2 enviada');

  let prevLen = 0;
  let stable = 0;
  const inicio = Date.now();

  while (Date.now() - inicio < 300000) {
    await page.waitForTimeout(3000);
    const textLen = await page.evaluate(() => document.body.innerText.length);
    if (textLen === prevLen) {
      stable += 3;
      if (stable >= 18) break;
    } else {
      stable = 0;
      prevLen = textLen;
      process.stdout.write('█');
    }
  }

  const res = await page.evaluate(() => document.body.innerText);
  console.log('\n\n=== GEMINI RESPONDE ===');
  console.log(res);
  console.log('\n==== FIN ====');
  await browser.close();
})().catch(e => console.error('Error:', e.message));
