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

async function connect(url) {
  let pages = await getPages();
  let p = pages.find(pg => pg.url.includes(url));
  if (!p) { console.log('NO_PAGE matching', url); return null; }
  const ws = new WebSocket(p.webSocketDebuggerUrl);
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
  let c = await connect('project/gmbqwybdrstmmdbcmitw');
  if (!c) return;
  
  // Navigate to SQL editor
  await c.send('Runtime.evaluate', {
    expression: "window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/settings/api'",
    returnByValue: true
  });
  console.log('Navigated...');
  await new Promise(r => setTimeout(r, 6000));
  
  c.ws.close();
  await new Promise(r => setTimeout(r, 1500));
  
  c = await connect('settings/api');
  if (!c) {
    console.log('Checking all pages...');
    (await getPages()).filter(p => p.url.includes('supabase')).forEach(f => console.log(f.title, '|', f.url.substring(0, 130)));
    return;
  }
  
  const r = await c.send('Runtime.evaluate', {
    expression: `
      JSON.stringify({
        url: window.location.href,
        title: document.title,
        body: document.body.innerText.substring(0, 4000)
      })
    `,
    returnByValue: true
  });
  console.log('PAGE:', r?.result?.result?.value);
  
  c.ws.close();
}

main();
