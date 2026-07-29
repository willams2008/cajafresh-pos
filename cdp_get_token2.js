const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com') && !p.url.includes('stripe') && p.title.includes('Access Tokens'));
    if (!p) { console.log('NO_PAGE'); return; }
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
        expression: 'try { var t = JSON.parse(localStorage.getItem("supabase.dashboard.auth.token")); JSON.stringify({ access_token: t.access_token, expires_at: t.expires_at }) } catch(e) { "error: " + e.message }',
        returnByValue: true
      });
      const val = r?.result?.result?.value || '';
      console.log('TOKEN_DATA:', val);

      const r2 = await send('Runtime.evaluate', {
        expression: 'try { var t2 = JSON.parse(localStorage.getItem("supabase.dashboard.auth.token-user")); JSON.stringify({ access_token: t2.access_token, expires_at: t2.expires_at }) } catch(e) { "error: " + e.message }',
        returnByValue: true
      });
      const val2 = r2?.result?.result?.value || '';
      console.log('TOKEN_USER:', val2);

      ws.close();
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
