const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com') && !p.url.includes('stripe') && p.title.includes('Access Tokens'));
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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 10000);
      });
    }
    ws.on('open', async () => {
      // First navigate to new project page
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj/projects/new' });
      console.log('Navigated to new project page...');
      
      // Wait for page to load
      await new Promise(r => setTimeout(r, 5000));
      
      // Get current page URL
      const urlR = await send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true
      });
      console.log('Current URL:', urlR?.result?.result?.value);

      // Try to create project via fetch from within the browser context
      const password = 'CajaFresh' + Math.random().toString(36).slice(2, 8) + '!';
      console.log('Attempting to create project with password:', password);
      
      const createResult = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            try {
              const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                  org_id: 'zyxkuofvorykdlnutrlj',
                  name: 'almacen-cliente',
                  plan: 'free',
                  db_pass: '${password}',
                  region: 'us-east-1',
                  db_version: '15.6.1.116'
                })
              });
              const data = await res.json();
              return JSON.stringify({ status: res.status, data: data, ok: res.ok });
            } catch(e) {
              return JSON.stringify({ error: e.message });
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: true
      });
      
      const result = createResult?.result?.result?.value || '{}';
      console.log('CREATE RESULT:', result);
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
