const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];

    const page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    console.log('URL:', page.url());

    const mensaje = `Necesito que analices un modulo de mi POS "Caja Fresh" llamado "Provisionar". Es un modulo de gestion de materiales, planos CAD, optimizacion de cortes y costeo.

FUNCIONALIDAD ACTUAL:
1. Inventario de Materia Prima: CRUD de materiales con nombre, largo, ancho, espesor, costo x m2, stock, color. Se guarda en localStorage.
2. Carga CAD: Dropzone para DXF, SVG, PDF. Visualizacion en canvas con zoom, pan, arrastre de piezas. Soporta multiples capas.
3. Optimizacion de Cortes: Algoritmo Guillotine/Shelf, ordena piezas por area, rotacion automatica, calculo de planchas necesarias y % de uso. Visualiza en canvas.
4. Costeo y Cotizacion: Inputs de costo plancha, costo corte, gastos adicionales, margen. Calcula costoProduccion, ganancia, precioVenta. Guarda en localStorage. Genera PDF con window.print().

PROBLEMAS: todo en localStorage (no SQLite), 1988 lines en una sola IIFE, algoritmo de nesting basico.

DAME RECOMENDACIONES ESPECIFICAS: que agregar, que mejorar, como migrar a SQLite, mejoras de UX, nuevas features.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(mensaje, { delay: 2 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');

    console.log('Enviado, esperando respuesta...');

    // Esperar hasta que aparezca "Gemini dijo"
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3000);
      const text = await page.evaluate(() => document.body.innerText);
      if (text.includes('Gemini dijo')) {
        console.log('Respuesta recibida tras', (i+1)*3, 'segundos');
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
    console.log('=== RECOMENDACIONES ===');
    console.log(gemini.join('\n').substring(0, 6000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
