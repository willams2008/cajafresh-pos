const { chromium } = require('playwright');

async function preguntaGemini(mensaje) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const timeout = 300000;

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  } else {
    await page.bringToFront();
    await page.waitForTimeout(2000);
  }

  // Buscar input con varios selectores
  let input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) input = await page.$('[contenteditable="true"]');
  if (!input) input = await page.$('[role="textbox"]');
  if (!input) { console.log('ERROR: No input encontrado en Gemini'); await browser.close(); return null; }

  await input.click();
  await page.waitForTimeout(500);

  // Seleccionar todo y borrar
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(200);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);

  await page.keyboard.type(mensaje, { delay: 2 });
  await page.waitForTimeout(800);

  // Intentar Enter directo
  await page.keyboard.press('Enter');
  console.log('✓ Mensaje enviado a Gemini');
  console.log('Esperando respuesta', new Date().toLocaleTimeString());

  let prevLen = 0;
  let stable = 0;
  const inicio = Date.now();

  while (Date.now() - inicio < timeout) {
    await page.waitForTimeout(3000);
    try {
      const textLen = await page.evaluate(() => document.body.innerText.length);
      if (textLen === prevLen) {
        stable += 3;
        if (stable >= 18) {
          console.log('\nRespuesta completa detectada');
          break;
        }
      } else {
        stable = 0;
        prevLen = textLen;
        process.stdout.write('█');
      }
    } catch(e) {
      console.log('\nError leyendo:', e.message);
      await page.waitForTimeout(5000);
    }
  }

  const res = await page.evaluate(() => document.body.innerText);
  console.log('\n\n=== GEMINI RESPONDE ===');
  console.log(res);
  console.log('\n==== FIN RESPUESTA ====');

  await browser.close();
  return res;
}

const msg = `Estoy diseniando un chatbot para WhatsApp que reemplazara el QR inestable de whatsapp-web.js en mi POS "Caja Fresh" (Electron + JS).

ARQUITECTURA QUE QUIERO USAR:
- Playwright conectado a Opera GX via CDP
- Opera GX tendra 2 pestanias: WhatsApp Web + Gemini Web
- Cuando llegue un mensaje de cliente, Playwright lo copia a Gemini y responde

PREGUNTAS:
1. Es buena idea o hay problemas graves con esta arquitectura?
2. Como manejar multiples clientes conversando al mismo tiempo?
3. Como hacer que Gemini recuerde el contexto de cada conversacion?
4. Como evitar que Gemini mezcle conversaciones de diferentes clientes?
5. Que hago si Gemini se tarda en responder?
6. Conviene usar la API de Gemini en vez del Web?
7. Como sincronizar datos del POS (catalogo, stock, precios) con el chatbot?

Dame recomendaciones CONCRETAS y CODIGO si aplica.`;

preguntaGemini(msg).catch(e => console.error('\nError:', e.message));
