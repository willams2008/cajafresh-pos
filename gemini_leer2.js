const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('gemini.google.com') || p.url().includes('gemini'));
  if (!page) { console.log('No hay pestana de Gemini'); return; }
  await page.bringToFront();
  await page.waitForTimeout(3000);

  console.log('URL:', page.url());

  // Scroll up to see history
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Tomar screenshot
  await page.screenshot({ path: 'gemini_screenshot.png', fullPage: true });
  console.log('Screenshot guardado como gemini_screenshot.png');

  const texto = await page.evaluate(() => document.body.innerText);
  console.log('--- TEXTO COMPLETO ---');
  console.log(texto.substring(0, 5000));
})();
