const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
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
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj/projects/new' });
      console.log('✅ Abri pagina de crear proyecto en Opera GX');
      console.log('Completa el formulario:');
      console.log('  - Nombre: almacen-cliente');
      console.log('  - Database Password: pon una segura');
      console.log('  - Region: US East (default)');
      console.log('  - Pricing Plan: Free');
      console.log('Luego click en "Create project" y espera ~2 min.');
      console.log('AVISAME cuando el proyecto este creado.');
      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
