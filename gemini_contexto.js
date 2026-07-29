const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    
    // Usar la pagina mas nueva que tenga Gemini (la fresca que creamos)
    let page = null;
    for (const p of ctx.pages()) {
      if (p.url().includes('gemini')) { page = p; break; }
    }
    if (!page) { console.log('No page found'); process.exit(1); }
    await page.bringToFront();
    await page.waitForTimeout(2000);

    const mensaje = `Perdon, te explico mejor el contexto:

"CAJA FRESH" es un sistema POS (Punto de Venta) de escritorio hecho con Electron + JavaScript Vanilla + SQLite + Express + Socket.io.

El modulo "PROVISIONAR" (archivo: src/features/provisionar.js, 1988 lines) es para fabricacion y carpinteria. Permite:

1. Gestionar inventario de materia prima (MDF, acrilico, etc) con dimensiones y costos
2. Cargar planos CAD (DXF, SVG, PDF) para ver las piezas a cortar
3. Optimizar cortes: algoritmo que acomoda piezas en planchas para minimizar desperdicio
4. Calcular costos y generar cotizaciones con margen de ganancia

PROBLEMAS ACTUALES:
- Todo el estado se guarda en localStorage, no en SQLite
- El codigo es una sola funcion gigante (1988 lines, IIFE)
- El algoritmo de nesting es basico (shelf)
- No usa Web Workers, todo en main thread

NECESITO QUE ME AYUDES A:
1. Disenar las tablas SQLite para este modulo
2. Estrategia de migracion de localStorage a SQLite
3. Mejor algoritmo de nesting (MaxRects? algo mejor?)
4. Implementacion de Web Workers en Electron Vanilla JS
5. Formula de costeo avanzado (incluyendo desperdicio, tiempo de maquina)
6. Sistema de trazabilidad de retales (sobrantes reutilizables)

DAME EJEMPLOS DE CODIGO.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }

    await input.click();
    await page.waitForTimeout(500);
    await input.fill('');
    await page.keyboard.type(mensaje, { delay: 1 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');

    console.log('Contexto enviado! Esperando respuesta...');

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
    console.log('=== GEMINI RESPONDE ===');
    console.log(gemini.join('\n').substring(0, 8000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
