const WebSocket = require('ws');
const http = require('http');

async function getPages() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', e => { console.error(e.message); resolve([]); });
  });
}

async function main() {
  let pages = await getPages();
  let p = pages.find(p => p.url.includes('supabase.com/dashboard/org/zyxkuofvorykdlnutrlj') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
  
  if (!p) {
    // Try the new project page
    p = pages.find(p => p.title === 'Supabase' && p.url.includes('/new'));
  }
  
  if (!p) { console.log('NO_PAGE'); return; }
  
  console.log('Using:', p.title, p.url.substring(0, 130));
  
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
    // Set URL directly
    await send('Runtime.evaluate', {
      expression: `window.location.href = 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj'`,
      returnByValue: true
    });
    console.log('Navigating...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Re-fetch pages - we may be on a new tab
    ws.close();
    
    await new Promise(r => setTimeout(r, 1000));
    pages = await getPages();
    p = pages.find(p => p.title.includes("Projects") || p.title.includes("willams2008's Org"));
    if (!p) { 
      console.log('Page not found after navigation. Available pages:');
      pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(f.title, '|', f.url.substring(0, 100)));
      return; 
    }
    
    console.log('New page:', p.title, p.url.substring(0, 130));
    
    const ws2 = new WebSocket(p.webSocketDebuggerUrl);
    let msgId2 = 1;
    function send2(method, params) {
      return new Promise((resolve2) => {
        const id = msgId2++;
        ws2.send(JSON.stringify({ id, method, params }));
        const handler = (data) => {
          try { const m = JSON.parse(data.toString()); if (m.id === id) resolve2(m); } catch(e) {}
        };
        ws2.on('message', handler);
        setTimeout(() => { ws2.removeListener('message', handler); resolve2(null); }, 10000);
      });
    }
    
    ws2.on('open', async () => {
      // Check page state
      const r = await send2('Runtime.evaluate', {
        expression: `
          (function() {
            var result = { url: window.location.href, title: document.title };
            
            // Find all buttons especially "New project"
            var elements = document.querySelectorAll('a, button');
            result.elements = [];
            elements.forEach(function(el) {
              var txt = el.textContent.trim().substring(0, 80);
              if (txt && txt.length < 80 && !txt.startsWith('http')) {
                result.elements.push({
                  tag: el.tagName,
                  text: txt,
                  href: (el.href || '').substring(0, 150),
                  rect: JSON.stringify(el.getBoundingClientRect())
                });
              }
            });
            
            result.body = document.body.innerText.substring(0, 1000);
            
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('STATE:', r?.result?.result?.value);
      
      ws2.close();
    });
    ws2.on('error', (e) => { console.error('Error:', e.message); });
  });
  ws.on('error', (e) => { console.error('Error:', e.message); });
}

main();
