const WebSocket = require('ws');
const http = require('http');

async function getPages() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', e => { console.error(e.message); resolve([]); });
  });
}

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  function send(method, params) {
    return new Promise((r) => {
      const mid = id++;
      ws.send(JSON.stringify({ id: mid, method, params }));
      const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === mid) r(m); } catch(e) {} };
      ws.on('message', h);
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 15000);
    });
  }
  return new Promise((r) => {
    ws.on('open', () => r({ ws, send }));
    ws.on('error', (e) => { console.error('WS Error:', e.message); r(null); });
  });
}

async function main() {
  let pages = await getPages();
  let p = pages.find(p => p.url.includes('gmbqwybdrstmmdbcmitw') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  let c = await connect(p);
  if (!c) return;
  
  // Navigate to Project Settings
  await c.send('Runtime.evaluate', {
    expression: `window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/settings/general'`,
    returnByValue: true
  });
  console.log('Navigating to Project Settings...');
  await new Promise(r => setTimeout(r, 5000));
  
  c.ws.close();
  await new Promise(r => setTimeout(r, 1500));
  
  pages = await getPages();
  p = pages.find(p => p.url.includes('settings/general') || (p.url.includes('settings') && p.url.includes('gmbqwybdrstmmdbcmitw')));
  if (!p) {
    console.log('Settings page not found. Available Supabase pages:');
    (await getPages()).filter(pg => pg.url.includes('supabase')).forEach(f => console.log(f.title.substring(0,60), '|', f.url.substring(0,130)));
    return;
  }
  
  c = await connect(p);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Try clicking on the API section
  const r = await c.send('Runtime.evaluate', {
    expression: `
      (function() {
        var result = { url: window.location.href, title: document.title };
        
        // Look for API link or section
        var links = document.querySelectorAll('a');
        result.apiLinks = [];
        links.forEach(function(l) {
          if (l.textContent.toLowerCase().includes('api') || (l.href || '').includes('/api')) {
            result.apiLinks.push({
              text: l.textContent.trim().substring(0, 50),
              href: (l.href || '').substring(0, 150)
            });
          }
        });
        
        // Look for API keys in the page text
        var text = document.body.innerText;
        result.textPreview = text.substring(0, 5000);
        
        // Find any input/textarea containing keys
        var keyInputs = [];
        document.querySelectorAll('input, textarea').forEach(function(el) {
          if (el.value && (el.value.includes('supabase') || el.value.startsWith('eyJ') || el.value.startsWith('sbp_'))) {
            keyInputs.push(el.value.substring(0, 200));
          }
        });
        result.keyInputs = keyInputs;
        
        return JSON.stringify(result);
      })()
    `,
    returnByValue: true
  });
  console.log('SETTINGS PAGE:', r?.result?.result?.value);
  
  c.ws.close();
  process.exit(0);
}

main();
