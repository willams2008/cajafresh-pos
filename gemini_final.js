const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    // Leer el codigo
    const codigo = fs.readFileSync('src/features/provisionar.js', 'utf8');
    const lines = codigo.split('\n');

    // Extraer partes clave (funciones principales)
    const funcionesClave = [];
    let currentFunc = '';
    let inFunc = false;
    for (const line of lines) {
      if (line.trim().startsWith('function ') || line.trim().match(/^\s+function /)) {
        if (currentFunc) funcionesClave.push(currentFunc);
        currentFunc = line + '\n';
        inFunc = true;
      } else if (inFunc) {
        currentFunc += line + '\n';
        if (line.includes('function ') || line.trim().startsWith('//')) {
          inFunc = false;
          funcionesClave.push(currentFunc);
          currentFunc = line + '\n';
          inFunc = true;
        }
      }
    }
    if (currentFunc) funcionesClave.push(currentFunc);

    const primerasFunciones = funcionesClave.slice(0, 10).join('\n\n');
    const resumen = `MODULO PROVISIONAR - RESUMEN:
- Archivo: src/features/provisionar.js
- Total: ${lines.length} lines
- Estado: materiales[], capasCAD[], piezasCAD[], resultadoCortes, cotizaciones[]
- 4 tabs: materiales, cad, cortes, costos
- Todo en localStorage

PRINCIPALES FUNCIONES:
${primerasFunciones.substring(0, 8000)}

...[resto omitido - 97k chars total]...

PREGUNTA: Con esta estructura, ¿QUE MEJORARIAS? Dame recomendaciones de: SQL migration, nesting algorithm, workers, costeo, trazabilidad de retales.`;

    // Poner texto directamente en el input via JS
    await page.evaluate((texto) => {
      const input = document.querySelector('div.ql-editor[contenteditable="true"]');
      if (input) {
        input.focus();
        // Usar execCommand para pegar texto
        document.execCommand('insertText', false, texto);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, `Hola Gemini. Este es el modulo "Provisionar" de mi POS Caja Fresh:\n\n${resumen}`);

    await page.waitForTimeout(2000);
    
    // Click send
    const btn = await page.$('button[aria-label="Enviar mensaje"], button[aria-label="Send message"]');
    if (btn) await btn.click();
    else await page.keyboard.press('Enter');

    console.log('Mensaje enviado con codigo! Esperando respuesta...');
    
    // Esperar hasta 60s
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const t = await page.evaluate(() => document.body.innerText);
      if (t.includes('Gemini dijo')) { console.log('Respondio en', (i+1)*3, 's'); break; }
    }
    await page.waitForTimeout(5000);

    const texto = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync('gemini_respuesta_provisionar.txt', texto, 'utf8');
    
    const lines2 = texto.split('\n').filter(l => l.trim());
    let capture = false;
    const resp = [];
    for (const l of lines2) {
      if (l === 'Gemini dijo' || l.startsWith('Gemini dijo')) capture = true;
      if (l.startsWith('Tú dijiste') || l.startsWith('Tú:')) capture = false;
      if (capture && l) resp.push(l);
    }
    console.log('=== RECOMENDACIONES ===');
    console.log(resp.join('\n').substring(0, 10000));
    console.log('\n\nRespuesta completa guardada en gemini_respuesta_provisionar.txt');
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
