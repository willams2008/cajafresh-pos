const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('api-keys'));
    if (!p) { console.log('NO_PAGE'); return; }
    
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    let id = 1;
    function send(method, params) {
      return new Promise((r) => {
        const mid = id++;
        ws.send(JSON.stringify({ id: mid, method, params }));
        const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === mid) r(m); } catch(e) {} };
        ws.on('message', h);
        setTimeout(() => { ws.removeListener('message', h); r(null); }, 10000);
      });
    }
    
    ws.on('open', async () => {
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            url: 'https://gmbqwybdrstmmdbcmitw.supabase.co',
            anonKey: document.querySelector('input[type="text"]')?.value || '',
            serviceKey: document.querySelector('input[type="password"]')?.value || ''
          })
        `,
        returnByValue: true
      });
      console.log(r?.result?.result?.value);
      ws.close();
      process.exit(0);
    });
  });
}).on('error', e => { console.error('Error:', e.message); process.exit(1); });
