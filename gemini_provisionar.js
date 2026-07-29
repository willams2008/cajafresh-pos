const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find(p => p.url().includes('gemini'));
    if (!page) {
      page = await ctx.newPage();
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
    }
    await page.bringToFront();

    const mensaje = `Estoy desarrollando el modulo "Provisionar" en mi POS "Caja Fresh" (Electron + Vanilla JS).

Este modulo actualmente tiene:
1. Inventario de Materia Prima (CRUD con localstorage)
2. Carga CAD (DXF, SVG, PDF con canvas viewer)
3. Optimizacion de Cortes (rectangulos en laminas)
4. Costeo y Cotizacion (con margen de ganancia y PDF)

¿Que mejorarias, agregarias o cambiarias? Dame recomendaciones concretas de codigo, nuevas features o integraciones.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(mensaje, { delay: 3 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    // Esperar que desaparezca el texto del input (se envio)
    let sent = false;
    for (let i = 0; i < 10; i++) {
      const txt = await page.evaluate(() => document.querySelector('div.ql-editor[contenteditable="true"]')?.textContent || '');
      if (txt.trim().length < 5) { sent = true; break; }
      // Click send button
      const btn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"]');
      if (btn) await btn.click();
      await page.waitForTimeout(1000);
    }
    console.log('Mensaje enviado:', sent);

    // Esperar respuesta - verificar que el boton stop desaparezca
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(3000);
      const btns = await page.$$('button');
      let stopFound = false;
      for (const b of btns) {
        const html = await b.innerHTML();
        if (html.includes('stop') || html.includes('Stop')) { stopFound = true; break; }
      }
      if (!stopFound) {
        // Podria haber terminado
        if (i > 5) break; // Al menos 18s de espera
      }
    }
    
    // Esperar un poco mas para asegurar
    await page.waitForTimeout(5000);

    // Guardar todo el texto a archivo
    const texto = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('gemini_respuesta.txt', texto, 'utf8');
    console.log('Respuesta guardada en gemini_respuesta.txt');

    // Extraer solo la parte de Gemini
    const lines = texto.split('\n').filter(l => l.trim());
    const geminiLines = [];
    let capture = false;
    for (const line of lines) {
      const clean = line.trim();
      if (clean.includes('Gemini dijo') || clean === 'Gemini dijo') capture = true;
      if (clean.includes('Tú dijiste') || clean.includes('Tú:')) capture = false;
      if (capture && clean) geminiLines.push(clean);
    }

    const respuesta = geminiLines.slice(-40).join('\n');
    console.log('=== RESPUESTA DE GEMINI ===');
    console.log(respuesta);
    console.log('\n=== FIN ===');
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
