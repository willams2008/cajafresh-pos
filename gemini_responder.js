const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    // Buscar la pagina mas nueva que no sea la de Lenovo
    let page = null;
    for (const p of pages) {
      if (p.url().includes('gemini')) { page = p; break; }
    }
    if (!page) {
      const all = ctx.pages();
      page = all[all.length - 1];
    }
    await page.bringToFront();
    await page.waitForTimeout(2000);

    console.log('Pagina actual:', page.url());

    const mensaje = `Excelente analisis, muchas gracias. Me gusto mucho tu enfoque. 

Quiero implementar tus recomendaciones. Dame mas detalles sobre:

1. **Base de Datos**: Disenia la estructura de tablas SQLite para este modulo. Necesito tablas para: materiales, retales (sobrantes), piezas CAD, resultados de optimizacion, cotizaciones.

2. **Workers**: Como implementar Web Workers en Electron (Vanilla JS) para que el algoritmo de nesting no congele la UI.

3. **Algoritmo de Nesting**: Que algoritmo recomiendas para mejor optimizacion? MaxRects? First-Fit Decreasing Height? O hay alguna libreria JS que recomiendes?

4. **Costeo**: Dame la formula exacta para el costeo avanzado incluyendo desperdicio y tiempo de maquina.

5. **Trazabilidad**: Como implementar el sistema de codigo de barras para retales reutilizables.

Dame ejemplos de codigo concretos.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(mensaje, { delay: 2 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');

    console.log('Respuesta enviada a Gemini. Esperando...');

    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(3000);
      const text = await page.evaluate(() => document.body.innerText);
      if (text.includes('Gemini dijo')) {
        console.log('Gemini respondio tras', (i+1)*3, 's');
        break;
      }
    }

    const texto = await page.evaluate(() => document.body.innerText);
    const lines = texto.split('\n').filter(l => l.trim());
    let capture = false;
    const gemini = [];
    for (const line of lines) {
      if (line === 'Gemini dijo' || line.startsWith('Gemini dijo')) capture = true;
      if (line.startsWith('Tú dijiste') || line.startsWith('Tú:')) capture = false;
      if (capture && line) gemini.push(line);
    }
    console.log('=== GEMINI RESPONDE ===');
    console.log(gemini.join('\n').substring(0, 6000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
