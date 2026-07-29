const { chromium } = require('playwright');

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

    const mensaje = `IGNORA TODO LO ANTERIOR. Este es un nuevo mensaje:

Necesito que analices ESPECIFICAMENTE el modulo "Provisionar" de mi POS. Aqui esta el codigo resumido y su estructura completa:

El modulo tiene 4 pestanas:
1. MATERIA PRIMA: CRUD de materiales con nombre, propiedades, largo (mm), ancho (mm), espesor (mm), costo x m2, stock (planchas), color. Los datos se guardan en localStorage. Cada material tiene retales (sobrantes) e historial de uso. Renderiza tabla con acordeon.

2. CARGA CAD: Dropzone para subir archivos DXF, SVG, PDF. Visualizacion en canvas con zoom/paneo. Las piezas se pueden arrastrar. Los materiales se pueden soltar desde una paleta. Soporta multiples capas.

3. OPTIMIZACION DE CORTES: Algoritmo Guillotine/Shelf que agrupa piezas por material asignado, las ordena por area descendente, las anida en planchas virtuales calculando uso % y desperdicio. Visualiza resultado en canvas con zoom/paneo. Calcula planchas necesarias.

4. COSTEO Y COTIZACION: Inputs para costo plancha, costo corte, gastos adicionales, margen %. Calcula: costoTotalMaterial, costoProduccion, ganancia, precioVenta. Guarda cotizaciones en localStorage. Genera PDF para imprimir con window.print().

PREGUNTA CONCRETA: Dame recomendaciones ESPECIFICAS para mejorar SOLO este modulo. Que nuevas funciones agregar, que mejorar del codigo, que problemas ves, como integrarlo con el backend SQLite en vez de localStorage, mejoras UX, etc.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(300);
    await input.fill('');
    await page.waitForTimeout(200);
    await page.keyboard.type(mensaje, { delay: 1 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    console.log('Enviado, esperando 35s...');
    await page.waitForTimeout(35000);

    const texto = await page.evaluate(() => document.body.innerText);
    const lines = texto.split('\n').filter(l => l.trim());
    let capture = false;
    const gemini = [];
    for (const line of lines) {
      if (line.includes('Gemini dijo') || line === 'Gemini dijo') capture = true;
      if (line.includes('Tú dijiste') || line.includes('Tú:')) capture = false;
      if (capture && line) gemini.push(line);
    }
    console.log('=== RECOMENDACIONES DE GEMINI ===');
    console.log(gemini.join('\n').substring(0, 5000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
