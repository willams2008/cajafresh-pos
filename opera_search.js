const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Programs\\Opera GX\\opera.exe',
    headless: false
  });

  const page = await browser.newPage();
  await page.goto('https://www.google.com');
  await page.waitForSelector('textarea[name="q"]', { timeout: 10000 });
  await page.fill('textarea[name="q"]', 'Caja Fresh');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);

  console.log('Busqueda completada. Navegador permanece abierto.');
})();
