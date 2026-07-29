const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find(p => p.url().includes('gemini.google.com'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  } else {
    await page.bringToFront();
    await page.waitForTimeout(2000);
  }

  const title = await page.title();
  const url = page.url();
  console.log('Título:', title);
  console.log('URL:', url);

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Texto visible:', bodyText);

  const hasInput = await page.$('div.ql-editor[contenteditable="true"]');
  console.log('¿Hay input de texto?', !!hasInput);

  await browser.close();
})();
