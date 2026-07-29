const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('integrations/data_api'));
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
      await new Promise(r => setTimeout(r, 2000));
      
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var body = document.body;
            var text = body.innerText;
            var result = { text: text.substring(0, 5000) };
            
            // Find the project URL pattern
            var urlMatch = text.match(/https?:\\/\\/[a-zA-Z0-9][a-zA-Z0-9-]*\\.supabase\\.co/i);
            if (urlMatch) result.projectUrl = urlMatch[0];
            
            // Find JWT anon key
            var jwtMatch = text.match(/eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}/);
            if (jwtMatch) result.anonKey = jwtMatch[0];
            
            // Look for input fields with values
            var inputs = [];
            document.querySelectorAll('input').forEach(function(inp) {
              if (inp.value && (inp.value.includes('supabase.co') || inp.value.startsWith('eyJ'))) {
                inputs.push(inp.value.substring(0, 200));
              }
            });
            result.inputs = inputs;
            
            // Check copy buttons - the text next to them
            var copySections = [];
            document.querySelectorAll('[class*="copy"], [class*="code"]').forEach(function(el) {
              copySections.push(el.textContent.substring(0, 300));
            });
            result.codeSections = copySections;
            
            // Look for pre/code blocks
            var codes = [];
            document.querySelectorAll('pre, code').forEach(function(el) {
              var t = el.textContent.trim();
              if (t.length > 10 && t.length < 300) codes.push(t);
            });
            result.codes = codes;
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('INTEGRATIONS PAGE:', r?.result?.result?.value);
      
      ws.close();
      process.exit(0);
    });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
