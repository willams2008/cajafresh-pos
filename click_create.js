const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages[0];
    
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
      // Navigate to org home
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj' });
      console.log('Navigated to org home...');
      await new Promise(r => setTimeout(r, 5000));
      
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var result = {
              url: window.location.href,
              title: document.title,
              buttons: [],
              newProjectBtn: null,
              links: []
            };
            
            document.querySelectorAll('a').forEach(function(a) {
              var href = a.href || '';
              if (href.includes('new') || href.includes('create') || a.textContent.toLowerCase().includes('new project')) {
                result.links.push({ text: a.textContent.trim().substring(0, 80), href: href.substring(0, 150) });
              }
            });
            
            document.querySelectorAll('button').forEach(function(b) {
              var txt = b.textContent.trim().substring(0, 80);
              if (txt && txt.length < 80) {
                result.buttons.push({ text: txt, disabled: b.disabled });
              }
            });
            
            result.body = document.body.innerText.substring(0, 800);
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('ORG HOME:', r?.result?.result?.value);
      
      // Now try clicking "New project" button using the correct selector
      // Supabase uses shadcn/ui with button elements
      const clickR = await send('Runtime.evaluate', {
        expression: `
          (function() {
            // Try to find and click "New Project" button
            var buttons = Array.from(document.querySelectorAll('a, button'));
            var target = buttons.find(function(el) {
              var txt = el.textContent.toLowerCase().trim();
              return txt.includes('new project');
            });
            
            if (target) {
              var rect = target.getBoundingClientRect();
              return JSON.stringify({
                found: true,
                text: target.textContent.trim(),
                tag: target.tagName,
                rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
                href: target.href || ''
              });
            } else {
              // Try nav links
              var navLinks = Array.from(document.querySelectorAll('nav a, [role="navigation"] a'));
              return JSON.stringify({
                found: false,
                allTxt: buttons.map(function(b) { return b.textContent.trim().substring(0, 60); }).filter(Boolean)
              });
            }
          })()
        `,
        returnByValue: true
      });
      console.log('SEARCH BTN:', clickR?.result?.result?.value);
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
