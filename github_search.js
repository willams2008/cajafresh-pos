const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const defaultContext = browser.contexts()[0];
  const page = await defaultContext.newPage();

  await page.goto('https://github.com/search?q=electron+pos+system+open+source&type=repositories');
  await page.waitForTimeout(3000);

  console.log('Pagina cargada. Busqueda completada.');
})();
