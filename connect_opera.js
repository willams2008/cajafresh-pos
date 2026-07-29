const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const defaultContext = browser.contexts()[0];
  const pages = defaultContext.pages();

  console.log(`Conectado a Opera GX. Pestañas abiertas: ${pages.length}`);
  pages.forEach((p, i) => {
    console.log(`  [${i}] ${p.url()}`);
  });

  // Mantener vivo para comandos posteriores
  console.log('\nConexion establecida. Listo para recibir comandos.');
})();
