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

    const mensaje = `Aqui tienes el codigo completo del modulo "Provisionar" de mi POS Caja Fresh. Es un modulo de gestion de materiales, CAD, cortes y costeo. Analizalo y dime QUE MEJORARIAS, QUE AGREGARIAS O QUE CAMBIARIAS:

ESTRUCTURA DEL MODULO (1988 lines):

1. Estado global: materiales[], capasCAD[], piezasCAD[], resultadoCortes, cotizaciones[], planchasActivas[], camaras virtuales para canvas

2. INIT: carga estado de localStorage, renderiza materiales, init CAD dropzone, event listeners para canvas (wheel zoom, drag pan, drag piezas, drop materiales)

3. Materia Prima CRUD: 
  - abrirModalNuevoMaterial(materialParaEditar): modal SweetAlert con campos (nombre, propiedades, largo, ancho, espesor, costoM2, stock, color)
  - Guarda en localStorage, calcula areaM2 y costoPlancha
  - eliminarMaterial(id), renderMateriales() con tabla + acordeon de retales/historial

4. CAD:
  - initCADDropZone(): drag & drop de archivos DXF, SVG, PDF
  - cargaArchivoCAD(file): parsea segun extension, dibuja en canvas
  - redibujarCanvasCAD(): renderiza piezas con transformaciones
  - hitTestPieza(): deteccion de click en piezas
  - getCADTransformInfo(): calculo de escala/offset

5. Optimizacion de Cortes (algoritmo Guillotine/Shelf):
  - optimizarCortes(): agrupa piezas por material, ordena por area descendente, algoritmo de anidado con rotacion
  - Calcula planchas necesarias, uso %, desperdicio
  - dibujarLayoutCortes(): visualizacion en canvas

6. Costeo y Cotizacion:
  - actualizarCotizacion(): calcula costo material + corte + adicionales + margen = precio venta
  - guardarCotizacion(): persiste en localStorage
  - imprimirCotizacion(): genera PDF para impresion

TODO SE GUARDA EN LOCALSTORAGE (no hay backend).

Dame recomendaciones concretas de: nuevas features, mejoras de codigo, UX, integracion con SQLite/backend, optimizaciones, etc.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { process.exit(1); }

    await input.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(mensaje, { delay: 1 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    console.log('Mensaje enviado. Esperando 30s para respuesta...');
    await page.waitForTimeout(30000);

    const texto = await page.evaluate(() => document.body.innerText);
    const lines = texto.split('\n').filter(l => l.trim());
    let capture = false;
    const gemini = [];
    for (const line of lines) {
      if (line.includes('Gemini dijo') || line === 'Gemini dijo') capture = true;
      if (line.includes('Tú dijiste') || line.includes('Tú:')) capture = false;
      if (capture) gemini.push(line);
    }
    console.log('=== GEMINI RECOMIENDA ===');
    console.log(gemini.join('\n').substring(0, 4000));
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
