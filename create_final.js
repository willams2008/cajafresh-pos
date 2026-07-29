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
        setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 15000);
      });
    }
    ws.on('open', async () => {
      // First navigate to the org settings to get proper org_id
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj/settings' });
      console.log('Navigating to org settings...');
      await new Promise(r => setTimeout(r, 3000));
      
      // Try to create project via Supabase dashboard's internal API
      // The dashboard makes POST to /api/projects
      const password = 'CajaFresh_' + Math.random().toString(36).slice(2, 10) + '_2026!';
      console.log('Password:', password);
      
      // First, let's check what API endpoint the dashboard uses by looking at the fetch
      const result = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            try {
              const token = JSON.parse(localStorage.getItem("supabase.dashboard.auth.token")).access_token;
              
              // Try the dashboard's own Next.js API route
              const res = await fetch('/api/platform/projects', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                  org_id: 'zyxkuofvorykdlnutrlj',
                  name: 'almacen-cliente',
                  plan: 'free',
                  db_pass: '${password}',
                  region: 'us-east-1',
                  db_version: '15.6.1.116'
                })
              });
              
              const text = await res.text();
              return 'HTTP ' + res.status + ': ' + text.substring(0, 1000);
            } catch(e) {
              return 'ERROR: ' + e.message;
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: true
      });
      
      console.log('RESULT:', result?.result?.result?.value || 'NONE');
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
