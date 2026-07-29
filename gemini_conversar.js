const { chromium } = require('playwright');

async function hablarConGemini(mensaje) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  } else {
    await page.bringToFront();
    await page.waitForTimeout(2000);
  }

  const input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) { console.log('ERROR: Input no encontrado'); await browser.close(); return; }

  await input.click();
  await page.waitForTimeout(500);
  await page.keyboard.type(mensaje, { delay: 1 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  console.log('✅ Mensaje enviado a Gemini');

  // Esperar respuesta - detectar cuando el texto deja de crecer
  let prevLen = 0;
  let stableSecs = 0;
  const startTime = Date.now();

  while (Date.now() - startTime < 300000) { // max 5min
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
    const currentLen = text.length;

    if (currentLen === prevLen) {
      stableSecs += 2;
      if (stableSecs >= 12) break; // 12s sin cambio = respuesta completa
    } else {
      stableSecs = 0;
      prevLen = currentLen;
      process.stdout.write('▊');
    }
  }

  const finalText = await page.evaluate(() => document.body.innerText);
  console.log('\n\n=== GEMINI DICE ===');
  console.log(finalText);
  console.log('\n=== FIN ===');

  await browser.close();
  return finalText;
}

// Mensaje inicial
const msg = `Tengo un sistema POS hecho en Electron + JavaScript, se llama Caja Fresh / Punto Pila POS.

Actualmente uso whatsapp-web.js con QR para enviar notificaciones al jefe. El QR es inestable.

Quiero reemplazarlo con un chatbot WhatsApp que:
1. Ayude a clientes automaticamente (precios, horarios, disponibilidad, pedidos)
2. Ayude al jefe con reportes y alertas
3. Sea simple, sin depender de APIs de Meta ni servicios cloud

MI IDEA: Usar Playwright conectado a Opera GX (CDP), tener WhatsApp Web en una pestania y Gemini Web en otra. Cuando llegue un mensaje de WhatsApp, copiarlo a Gemini y responder.

¿QUE OPINAS de esta arquitectura? Pros, contras, recomendaciones para un negocio pequenio en Venezuela. Dame analisis completo.`;

hablarConGemini(msg).catch(e => console.error('Error:', e.message));
