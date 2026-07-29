const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto('https://gemini.google.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  console.log('Gemini URL:', page.url());

  const title = await page.title();
  console.log('Titulo de pagina:', title);
})();
