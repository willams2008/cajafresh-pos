const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto('https://www.google.com');
  await page.waitForTimeout(3000);

  const searchBox = await page.$('textarea[name="q"], input[name="q"]');
  if (searchBox) {
    await searchBox.click();
    await page.keyboard.type('que le parece todo mi proyecto caja fresh pos', { delay: 30 });
    await page.keyboard.press('Enter');
    console.log('Busqueda enviada a Google');
  } else {
    console.log('No se encontro el cuadro de busqueda');
  }
})();
