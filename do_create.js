const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    // Use the Supabase organizations page
    const p = pages.find(p => p.title.includes('Organizations') && p.url.includes('supabase'));
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
      console.log('Connected to organizations page');
      
      // Navigate to new project page
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj/projects/new' });
      console.log('Navigating to new project page...');
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Check current URL
      const urlR = await send('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true
      });
      console.log('Current URL:', urlR?.result?.result?.value);
      
      // Check page content
      const r = await send('Runtime.evaluate', {
        expression: `
          JSON.stringify({
            title: document.title,
            h1: document.querySelector('h1')?.textContent || '',
            buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().substring(0, 60)).filter(Boolean),
            inputs: Array.from(document.querySelectorAll('input')).map(i => ({ p: i.placeholder, t: i.type })),
            regionSelect: document.querySelector('select') ? true : false
          })
        `,
        returnByValue: true
      });
      console.log('PAGE:', r?.result?.result?.value);
      
      // If we're on the right page, try to create the project
      const password = 'CajaFresh_' + Math.random().toString(36).slice(2, 10) + '!';
      console.log('Using password:', password);
      
      // First, check what input fields are available
      const fieldsR = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var allInputs = document.querySelectorAll('input, select, textarea');
            var result = [];
            allInputs.forEach(function(el) {
              result.push({
                tag: el.tagName,
                type: el.type || '',
                name: el.name || '',
                placeholder: el.placeholder || '',
                id: el.id || '',
                label: (el.closest('label') ? el.closest('label').textContent : '') || 
                       (document.querySelector('label[for=\"' + el.id + '\"]') ? 
                        document.querySelector('label[for=\"' + el.id + '\"]').textContent : '') ||
                       ''
              });
            });
            return JSON.stringify(result);
          })()
        `,
        returnByValue: true
      });
      console.log('FIELDS:', fieldsR?.result?.result?.value);
      
      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
  });
}).on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
