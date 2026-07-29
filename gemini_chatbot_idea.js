const { chromium } = require('playwright');

(async () => {
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

  const mensaje = `Tengo un sistema POS hecho en Electron + JavaScript, se llama Caja Fresh / Punto Pila POS. Actualmente uso whatsapp-web.js con QR para enviar notificaciones al jefe (ventas, reportes). El QR es inestable, se desconecta seguido.

Quiero reemplazarlo con un chatbot WhatsApp que:

1. Ayude a los clientes automaticamente (precios, horarios, disponibilidad, tomar pedidos)
2. Ayude al jefe con reportes y alertas
3. Sea lo MAS SIMPLE posible de implementar, sin depender de APIs de Meta ni servicios en la nube

Mi idea actual: usar Playwright conectado a Opera GX (que ya tengo funcionando con CDP), tener WhatsApp Web abierto en una pestaña y Gemini Web en otra. Cuando llegue un mensaje de WhatsApp, copiarlo a Gemini, obtener respuesta y responder.

¿Qué opinas de esta arquitectura? ¿Pros y contras? ¿Recomiendas algo mejor para un negocio pequeño en Venezuela?

Dame tu análisis completo.`;

  const input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) { console.log('Input no encontrado'); process.exit(1); }

  await input.click();
  await page.waitForTimeout(500);

  for (let i = 0; i < mensaje.length; i++) {
    await page.keyboard.type(mensaje[i], { delay: 1 });
  }

  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  console.log('✅ Mensaje enviado a Gemini. Esperando respuesta...');

  let prevLength = 0;
  let stableCount = 0;

  for (let espera = 0; espera < 180; espera++) {
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
    if (text.length === prevLength) {
      stableCount++;
      if (stableCount > 5) break;
    } else {
      stableCount = 0;
      prevLength = text.length;
    }
    process.stdout.write('.');
  }

  const textContent = await page.evaluate(() => document.body.innerText);
  console.log('\n\n=== RESPUESTA DE GEMINI ===\n');
  console.log(textContent.substring(0, 12000));
  if (textContent.length > 12000) console.log('\n... (continuación) ...\n' + textContent.substring(12000, 18000));

  console.log('\n\n✅ Gemini respondió. Puedo seguir preguntándole si quieres.');
  await browser.close();
})().catch(e => console.error('Error:', e.message));
