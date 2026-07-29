const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('/project/gmbqwybdrstmmdbcmitw'));
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
      // Navigate to API settings
      await send('Runtime.evaluate', {
        expression: "window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/settings/api'",
        returnByValue: true
      });
      console.log('Navigating to API settings...');
      await new Promise(r => setTimeout(r, 5000));
      
      // Get the anon key and URL from the page
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var body = document.body.innerText;
            var result = { body: body.substring(0, 3000) };
            
            // Try to find the project URL and anon key from text
            var urlMatch = body.match(/https?:\\/\\/[a-zA-Z0-9-]+\\.supabase\\.co/i);
            if (urlMatch) result.url = urlMatch[0];
            
            var anonMatch = body.match(/eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/);
            if (anonMatch) result.anonKey = anonMatch[0];
            
            // Look for config blocks
            var preBlocks = [];
            document.querySelectorAll('pre, code').forEach(function(el) {
              preBlocks.push(el.textContent.substring(0, 500));
            });
            result.preBlocks = preBlocks;
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('API SETTINGS:', r?.result?.result?.value);
      
      ws.close();
      process.exit(0);
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
