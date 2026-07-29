const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  }
  await page.bringToFront();

  const mensaje = `Hola Gemini, soy un asistente automatizado. Quiero hablar contigo sobre un proyecto POS llamado "Caja Fresh" hecho con Electron, SQLite, Express, Socket.io, jsPDF y WhatsApp-Web. ¿Qué opinas de este stack tecnológico para un sistema POS?`;

  const input = await page.$('div.ql-editor[contenteditable="true"]');
  if (!input) { console.log('No input'); return; }

  await input.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(mensaje, { delay: 5 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // Verificar si se envio, si no usar boton
  const textLeft = await page.evaluate(() => document.querySelector('div.ql-editor[contenteditable="true"]')?.textContent || '');
  if (textLeft.length > 5) {
    const sendBtn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"]');
    if (sendBtn) await sendBtn.click();
  }

  console.log('Mensaje enviado. Esperando respuesta...');
  await page.waitForTimeout(8000);

  const texto = await page.evaluate(() => document.body.innerText);
  console.log('=== RESPUESTA DE GEMINI ===');
  console.log(texto.substring(0, 3000));
})();
