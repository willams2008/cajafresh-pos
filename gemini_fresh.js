const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    
    // Cerrar TODAS las paginas Gemini viejas
    const oldPages = ctx.pages().filter(p => p.url().includes('gemini'));
    for (const p of oldPages) {
      await p.close().catch(() => {});
    }

    // Crear pagina FRESCA
    const page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    console.log('Chat nuevo creado en:', page.url());

    // Enviar mensaje SOLO sobre Provisionar
    const mensaje = `Necesito que analices el modulo "Provisionar" de mi POS "Caja Fresh".

ESTO ES LO QUE HACE EL MODULO (codigo resumido):
- Pestana 1 - Materia Prima: CRUD de materiales (nombre, largo, ancho, espesor, costoM2, stock, color). Guarda en localStorage.
- Pestana 2 - Carga CAD: Dropzone para DXF, SVG, PDF. Visualiza en canvas con zoom/pan/arrastre.
- Pestana 3 - Optimizacion de Cortes: Algoritmo Guillotine/Shelf. Agrupa piezas por material, ordena por area, anida en planchas. Calcula % uso y desperdicio.
- Pestana 4 - Costeo: Inputs de costo, margen. Calcula precio venta. Guarda cotizaciones en localStorage.

PROBLEMAS QUE YO VEO:
1. Todo en localStorage, no usa SQLite
2. 1988 lines en una sola funcion IIFE
3. El nesting es basico (shelf)
4. No hay Workers, todo en main thread

QUE NECESITO DE TI:
1. Estructura de tablas SQLite para este modulo
2. Como migrar de localStorage a SQLite
3. Que algoritmo de nesting usar (MaxRects? Algo mejor?)
4. Como implementar Web Workers en Electron Vanilla JS
5. Mejoras de UX que recomiendes
6. Formula de costeo avanzado

DAME EJEMPLOS DE CODIGO CONCRETOS.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(500);
    await page.keyboard.type(mensaje, { delay: 1 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    
    console.log('Enviado a Gemini! Esperando respuesta...');

    // Esperar hasta 120s por respuesta
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(3000);
      const text = await page.evaluate(() => document.body.innerText);
      if (text.includes('Gemini dijo')) {
        console.log('Respondio en', (i+1)*3, 's');
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
    
    console.log('=== GEMINI SOBRE PROVISIONAR ===');
    console.log(gemini.join('\n').substring(0, 8000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
