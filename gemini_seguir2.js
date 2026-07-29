const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    let page = null;
    for (const p of ctx.pages()) {
      if (p.url().includes('gemini')) { page = p; break; }
    }
    if (!page) process.exit(1);
    await page.bringToFront();
    await page.waitForTimeout(2000);

    const msg = `Se corto tu respuesta en "Web Workers en Electron". Continua desde ahi:

- Dame el codigo completo de como implementar Web Workers en Electron con Vanilla JS para el nesting
- La formula matematica de costeo avanzado
- Trazabilidad de retales con QR
- Estructura de carpetas para modularizar el codigo

CONTINUA desde donde te quedaste.`;

    await page.evaluate((texto) => {
      const input = document.querySelector('div.ql-editor[contenteditable="true"]');
      if (input) {
        input.focus();
        document.execCommand('insertText', false, texto);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, msg);

    await page.waitForTimeout(2000);
    const btn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"]');
    if (btn) await btn.click();
    else await page.keyboard.press('Enter');

    console.log('Enviado! Esperando...');

    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3000);
      const t = await page.evaluate(() => document.body.innerText);
      if (t.includes('Gemini dijo')) { console.log('Respondio en', (i+1)*3, 's'); break; }
    }
    await page.waitForTimeout(5000);

    const texto = await page.evaluate(() => document.body.innerText);
    const lines = texto.split('\n').filter(l => l.trim());
    let capture = false;
    const resp = [];
    for (const l of lines) {
      if (l === 'Gemini dijo' || l.startsWith('Gemini dijo')) capture = true;
      if (l.startsWith('Tú dijiste') || l.startsWith('Tú:')) capture = false;
      if (capture && l) resp.push(l);
    }
    console.log('=== GEMINI ===');
    console.log(resp.join('\n').substring(0, 12000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
