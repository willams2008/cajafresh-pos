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
  let p = pages.find(p => p.url.includes('settings/general'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  let c = await connect(p);
  if (!c) return;
  
  // Navigate to API Keys page
  await c.send('Runtime.evaluate', {
    expression: `window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/settings/api-keys'`,
    returnByValue: true
  });
  console.log('Navigating to API Keys...');
  await new Promise(r => setTimeout(r, 6000));
  
  c.ws.close();
  await new Promise(r => setTimeout(r, 1500));
  
  // Also check if it redirected to legacy
  pages = await getPages();
  p = pages.find(p => (p.url.includes('api-keys') && p.url.includes('gmbqwybdrstmmdbcmitw')) || 
                       (p.url.includes('settings') && p.url.includes('/project') && !p.url.includes('stripe')));
  if (!p) {
    console.log('No matching page');
    pages.filter(pg => pg.url.includes('supabase.com/dashboard/project')).forEach(f => console.log(f.title.substring(0,60), '|', f.url.substring(0,130)));
    return;
  }
  
  console.log('Found page:', p.title.substring(0, 60), p.url.substring(0, 130));
  
  c = await connect(p);
  if (!c) return;
  
  await new Promise(r => setTimeout(r, 3000));
  
  const r = await c.send('Runtime.evaluate', {
    expression: `
      JSON.stringify({
        url: window.location.href,
        text: document.body.innerText.substring(0, 5000)
      })
    `,
    returnByValue: true
  });
  console.log('API KEYS PAGE:', r?.result?.result?.value);
  
  c.ws.close();
  process.exit(0);
}

main();
