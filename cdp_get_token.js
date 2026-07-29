const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard') && !p.url.includes('stripe'));
    if (!p) { console.log('NO_PAGE: Supabase dashboard not found'); return; }
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
      const r = await send('Runtime.evaluate', {
        expression: 'try { JSON.parse(localStorage.getItem("supabase.auth.token") || "{}").currentSession.access_token } catch(e) { "" }',
        returnByValue: true
      });
      const token = r?.result?.result?.value || '';
      if (token) {
        console.log('TOKEN:' + token);
      } else {
        const r2 = await send('Runtime.evaluate', {
          expression: 'try { JSON.parse(sessionStorage.getItem("supabase.auth.token") || "{}").access_token } catch(e) { "" }',
          returnByValue: true
        });
        const token2 = r2?.result?.result?.value || '';
        if (token2) console.log('TOKEN:' + token2);
        else console.log('NO_TOKEN');
      }
      ws.close();
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
