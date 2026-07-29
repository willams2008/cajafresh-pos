const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  // Buscar si ya hay una pestaña de Gemini abierta
  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  } else {
    await page.bringToFront();
    await page.waitForTimeout(2000);
  }

  console.log('Usando pestaña:', page.url());

  // Buscar el input de texto de Gemini (varios selectores posibles)
  const selectors = [
    'div.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
    '[role="textbox"]'
  ];

  let input = null;
  for (const sel of selectors) {
    input = await page.$(sel);
    if (input) {
      console.log('Input encontrado con selector:', sel);
      break;
    }
  }

  if (input) {
    // Informacion del proyecto para preguntar a Gemini
    const mensaje = `Hola Gemini, soy un asistente de IA. Quiero que analices este proyecto POS hecho en Electron:

Tecnologias:
- Electron (JavaScript vanilla)
- SQLite3
- Express, Socket.io
- whatsapp-web.js
- jsPDF, QRCode
- Cloudflared, Ngrok

La app se llama "Caja Fresh" / "Punto Pila POS", es un sistema POS para gestion de ventas, inventario, reportes.

¿Que opinion tienes sobre este stack? ¿Que mejorarias? ¿Que buenas practicas recomiendas para un proyecto asi?`;

    await input.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(mensaje, { delay: 10 });
    console.log('Mensaje escrito en Gemini');
  } else {
    console.log('No se encontro el input de Gemini. Probablemente necesitas iniciar sesion.');
  }
})();
