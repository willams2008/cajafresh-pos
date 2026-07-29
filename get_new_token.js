const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard/account/tokens'));
    if (!p) { console.log('NO_PAGE'); 
      pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(f.url.substring(0,100))); 
      return; 
    }
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
      // First, let's search the entire DOM for the token with a more thorough approach
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var texts = [];
            // Get all text nodes
            var walker = document.createTreeWalker(document.body, 4, null, false);
            var node;
            while (node = walker.nextNode()) {
              var t = node.textContent.trim();
              if (t.startsWith('sbp_') && t.length > 20) texts.push(t);
            }
            // Also check all elements
            var all = document.querySelectorAll('*');
            var els = [];
            all.forEach(function(el) {
              var t = el.textContent.trim();
              if (t.startsWith('sbp_') && t.length > 20) els.push(t.substring(0, 80));
            });
            return JSON.stringify({ textNodes: texts.slice(0,5), elements: els.slice(0,5) });
          })()
        `,
        returnByValue: true
      });
      console.log('DEEP SEARCH:', r?.result?.result?.value);

      // Also try to get the exact inner HTML of the success message area
      const r2 = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var sections = document.querySelectorAll('.rounded-lg.border');
            var results = [];
            sections.forEach(function(s) {
              results.push(s.innerText.substring(0, 500));
            });
            return JSON.stringify(results);
          })()
        `,
        returnByValue: true
      });
      console.log('SECTIONS:', r2?.result?.result?.value);

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
