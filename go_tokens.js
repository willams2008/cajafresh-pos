const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard') && !p.url.includes('stripe'));
    if (!p) { console.log('NO_PAGE'); return; }
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    let msgId = 1;
    function send(method, params) {
      return new Promise((resolve2) => {
        const id = msgId++;
        ws.send(JSON.stringify({ id, method, params }));
        const handler = (data) => {
          try { const m = JSON.parse(data.toString()); if (m.id === id) resolve2(m); } catch(e) {}
        };
        ws.on('message', handler);
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 5000);
      });
    }
    ws.on('open', async () => {
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/account/tokens' });
      console.log('Navegando a Access Tokens...');
      await new Promise(r => setTimeout(r, 2000));
      console.log('Listo! Ve a la pestana de Access Tokens en Opera GX');
      console.log('Crea un token nuevo y PEGALO AQUI para crear el proyecto.');
      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
