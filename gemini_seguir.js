const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    let page = null;
    for (const p of ctx.pages()) {
      if (p.url().includes('gemini')) { page = p; break; }
    }
    if (!page) { console.log('No Gemini page'); process.exit(1); }
    await page.bringToFront();
    await page.waitForTimeout(2000);

    const followUp = `Excelentes recomendaciones hasta ahora. Gracias!

Necesito que completes lo que faltaba y profundices:

1. **Librerias de Nesting**: Mencionaste que ibas a recomendar librerias pero se corto. ¿Cuales recomiendas para JS? (MaxRects? simpy2d? alguna otra?)

2. **Web Workers**: Dame un ejemplo concreto de como mover el algoritmo de nesting a un Web Worker en Electron con Vanilla JS. El worker deberia recibir las piezas y devolver las posiciones calculadas sin congelar la UI.

3. **Costeo Avanzado**: Dame la formula matematica completa para calcular:
   - CostoMaterial = ?
   - CostoDesperdicio = ?
   - CostoOperacion (tiempo maquina) = ?
   - PrecioVenta final con margen

4. **Trazabilidad de Retales**: Como implementar codigo de barras QR para retales reutilizables. Que datos guardar en el QR.

5. **Modularizacion**: Como dividir las 1989 lines en archivos separados manteniendo compatibilidad. Sugiere una estructura de carpetas.

DAME CODIGO EJECUTABLE.`;

    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (!input) { console.log('No input'); process.exit(1); }
    
    // Usar execCommand para pegar texto rapido
    await page.evaluate((texto) => {
      const input = document.querySelector('div.ql-editor[contenteditable="true"]');
      if (input) {
        input.focus();
        document.execCommand('insertText', false, texto);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, followUp);

    await page.waitForTimeout(2000);
    
    const btn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"]');
    if (btn) await btn.click();
    else await page.keyboard.press('Enter');

    console.log('Follow-up enviado! Esperando respuesta...');

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const t = await page.evaluate(() => document.body.innerText);
      if (t.includes('Gemini dijo')) { console.log('Respondio en', (i+1)*3, 's'); break; }
    }
    await page.waitForTimeout(3000);

    const texto = await page.evaluate(() => document.body.innerText);
    const lines = texto.split('\n').filter(l => l.trim());
    let capture = false;
    const resp = [];
    for (const l of lines) {
      if (l === 'Gemini dijo' || l.startsWith('Gemini dijo')) capture = true;
      if (l.startsWith('Tú dijiste') || l.startsWith('Tú:')) capture = false;
      if (capture && l) resp.push(l);
    }
    console.log('=== GEMINI RESPONDE ===');
    console.log(resp.join('\n').substring(0, 10000));
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
