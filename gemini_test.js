const { chromium } = require('playwright');

(async () => {
  try {
    console.log('1. Conectando a Opera...');
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    console.log('2. Conectado!');
    
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    console.log('3. Paginas abiertas:', pages.length);
    pages.forEach((p, i) => console.log(`   [${i}] ${p.url()}`));
    
    let page = pages.find(p => p.url().includes('gemini'));
    if (!page) {
      console.log('4. No hay pagina Gemini, creando una...');
      page = await ctx.newPage();
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
      console.log('5. Esperando carga...');
      await page.waitForTimeout(4000);
    } else {
      console.log('4. Usando pagina Gemini existente');
      await page.bringToFront();
    }
    
    console.log('5. URL actual:', page.url());
    console.log('6. Titulo:', await page.title());
    console.log('7. Buscando input...');
    
    const input = await page.$('div.ql-editor[contenteditable="true"]');
    if (input) {
      console.log('8. Input encontrado!');
      const mensaje = 'Hola, solo una prueba rapida. Dame 3 ideas para mejorar un modulo POS.';
      await input.click();
      await page.keyboard.type(mensaje, { delay: 5 });
      await page.keyboard.press('Enter');
      console.log('9. Mensaje enviado');
      
      await page.waitForTimeout(15000);
      
      const texto = await page.evaluate(() => document.body.innerText);
      const lines = texto.split('\n').slice(-30);
      console.log('10. Ultimas lineas:');
      lines.forEach(l => { if(l.trim()) console.log('  >', l.trim().substring(0, 200)); });
    } else {
      console.log('8. Input NO encontrado');
      console.log('9. Contenido de pagina:', await page.evaluate(() => document.body.innerText.substring(0, 1000)));
    }
    
    console.log('11. FIN');
    process.exit(0);
  } catch(e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
