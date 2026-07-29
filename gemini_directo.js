const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];

    // Pagina totalmente nueva
    const page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    const mensaje = `Hola Gemini, necesito tu ayuda para mejorar un modulo de mi proyecto "Caja Fresh POS". 

Es un modulo de ESCRITORIO hecho en Electron + JavaScript Vanilla, llamado "Provisionar". Es para FABRICACION (carpinteria, acrilicos, metales). Tiene 4 secciones:

1. MATERIA PRIMA: CRUD de materiales con nombre, dimensiones (largo, ancho, espesor en mm), costo x m2, stock en planchas. Guarda en localStorage.

2. CARGA CAD: Arrastrar archivos DXF, SVG, PDF. Los visualiza en un canvas con zoom, pan. Las piezas se pueden seleccionar y arrastrar.

3. OPTIMIZACION DE CORTES: Algoritmo Guillotine/Shelf que agrupa piezas por material, las ordena por area, las anida en planchas virtuales. Calcula % de uso y desperdicio.

4. COSTEO: Inputs para costo plancha, costo corte, gastos adicionales, margen de ganancia. Calcula precio de venta. Genera PDF para imprimir.

PROBLEMAS: todo en localStorage, 1988 lines en una sola funcion, algoritmo de nesting basico, sin Web Workers.

AYUDAME CON:
1. SQLite: estructura de tablas para materiales, retales, piezas, cotizaciones
2. Como migrar de localStorage a SQLite
3. Mejor algoritmo de nesting (MaxRects? librerias JS?)
4. Web Workers en Electron Vanilla JS
5. Formula de costeo con desperdicio y tiempo maquina
6. Trazabilidad de retales con codigo de barras

DAME CODIGO CONCRETO.`;

    // Hacer foco en el input
    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('Input no encontrado'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(1000);
    
    // Escribir caracter por caracter
    for (let i = 0; i < mensaje.length; i++) {
      await page.keyboard.type(mensaje[i], { delay: 1 });
    }
    
    await page.waitForTimeout(2000);
    
    // Tomar screenshot para verificar
    await page.screenshot({ path: 'gemini_antes_enviar.png' });
    
    // Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Si aun tiene texto, click boton
    const resto = await page.evaluate(() => document.querySelector('div.ql-editor[contenteditable="true"]')?.textContent?.length || 0);
    console.log('Texto restante en input:', resto);
    
    if (resto > 10) {
      const btn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"], button.send-button');
      if (btn) { await btn.click(); console.log('Click en boton enviar'); }
    }

    console.log('Enviado! Esperando respuesta 60s...');
    await page.waitForTimeout(60000);

    const textContent = await page.evaluate(() => document.body.innerText);
    
    // Guardar respuesta completa
    const lines = textContent.split('\n').filter(l => l.trim());
    let capture = false;
    const resp = [];
    for (const line of lines) {
      if (line === 'Gemini dijo' || line.startsWith('Gemini dijo')) capture = true;
      if (line.startsWith('Tú dijiste') || line.startsWith('Tú:')) capture = false;
      if (capture && line) resp.push(line);
    }
    
    console.log('=== RESPUESTA GEMINI ===');
    const responseText = resp.join('\n');
    console.log(responseText.substring(0, 8000));
    
    if (responseText.length > 8000) {
      console.log('\n\n... (continuacion) ...');
      console.log(responseText.substring(8000, 12000));
    }
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
