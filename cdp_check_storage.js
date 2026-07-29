const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com') && !p.url.includes('stripe') && p.title.includes('Access Tokens'));
    if (!p) { console.log('NO_PAGE: Access Tokens page not found'); 
      const found = pages.filter(p => p.url.includes('supabase.com') && !p.url.includes('stripe'));
      found.forEach(f => console.log(' -', f.title, f.url));
      return; 
    }
    const wsUrl = p.webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    function send(method, params) {
      return new Promise((resolve) => {
        const id = msgId++;
        ws.send(JSON.stringify({ id, method, params }));
        const handler = (data) => {
          try { const m = JSON.parse(data.toString()); if (m.id === id) resolve(m); } catch(e) {}
        };
        ws.on('message', handler);
        setTimeout(() => { ws.removeListener('message', handler); resolve(null); }, 3000);
      });
    }
    ws.on('open', async () => {
      // Check localStorage for any supabase keys
      const r = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(Object.keys(localStorage).filter(k => k.includes("supabase") || k.includes("sb-")))',
        returnByValue: true
      });
      console.log('Supabase keys:', r?.result?.result?.value || 'none');

      const r2 = await send('Runtime.evaluate', {
        expression: 'document.cookie.split(";").map(c => c.trim().split("=")[0]).filter(k => k.includes("sb") || k.includes("supa"))',
        returnByValue: true
      });
      console.log('Supabase cookies:', r2?.result?.result?.value || 'none');

      ws.close();
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
