const http = require('http');
const WebSocket = require('ws');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('/sql/new'));
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
      // Set up network request interception to capture the SQL API call
      await send('Network.enable', {});
      
      var requestUrl = '';
      ws.on('message', (data) => {
        try {
          var msg = JSON.parse(data.toString());
          if (msg.method === 'Network.requestWillBeSent' && msg.params) {
            var req = msg.params.request;
            if (req.url.includes('query') || req.url.includes('sql') || req.url.includes('database')) {
              console.log('REQUEST:', req.method, req.url.substring(0, 200));
              console.log('HEADERS:', JSON.stringify(req.headers).substring(0, 300));
              if (req.postData) console.log('BODY:', req.postData.substring(0, 300));
            }
          }
          if (msg.method === 'Network.responseReceived' && msg.params) {
            var resp = msg.params.response;
            if (resp.url.includes('query') || resp.url.includes('sql')) {
              console.log('RESPONSE:', resp.status, resp.url.substring(0, 200));
            }
          }
        } catch(e) {}
      });
      
      // Now click Run button
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            var buttons = document.querySelectorAll('button');
            for (var b of buttons) {
              if (b.textContent.trim().toLowerCase().startsWith('run')) {
                b.click();
                return 'clicked';
              }
            }
            return 'not found';
          })()
        `,
        returnByValue: true
      });
      
      console.log('Waiting for network requests...');
      await new Promise(r => setTimeout(r, 15000));
      
      ws.close();
      process.exit(0);
    });
  });
}).on('error', e => { console.error('Error:', e.message); process.exit(1); });
