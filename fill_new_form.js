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

async function connectToPage(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  return new Promise((resolve) => {
    ws.on('open', () => resolve({ ws, send }));
    ws.on('error', (e) => { console.error('WS Error:', e.message); resolve(null); });
  });
}

async function main() {
  let pages = await getPages();
  let p = pages.find(p => p.title.includes("Projects") && p.url.includes('supabase.com/dashboard/org'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  const c1 = await connectToPage(p);
  if (!c1) return;
  
  await c1.send('Runtime.evaluate', {
    expression: `window.location.href = 'https://supabase.com/dashboard/new/zyxkuofvorykdlnutrlj'`,
    returnByValue: true
  });
  console.log('Navigating...');
  await new Promise(r => setTimeout(r, 6000));
  c1.ws.close();
  
  await new Promise(r => setTimeout(r, 1500));
  pages = await getPages();
  p = pages.find(p => p.url.includes('/new/') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
  if (!p) {
    console.log('New page not found. Available:');
    pages.filter(p => p.url.includes('supabase')).forEach(f => console.log(f.title.substring(0,60), '|', f.url.substring(0,120)));
    return;
  }
  
  console.log('Found:', p.title, p.url.substring(0, 120));
  
  const c2 = await connectToPage(p);
  if (!c2) return;
  
  await new Promise(r => setTimeout(r, 3000));
  
  const r = await c2.send('Runtime.evaluate', {
    expression: `
      JSON.stringify({
        url: window.location.href,
        title: document.title,
        h1: document.querySelector('h1')?.textContent || '',
        inputs: Array.from(document.querySelectorAll('input')).map(function(i) {
          return { p: i.placeholder, t: i.type, name: i.name, id: i.id };
        }),
        buttons: Array.from(document.querySelectorAll('button')).map(function(b) {
          return { text: b.textContent.trim().substring(0,50), disabled: b.disabled };
        }).filter(function(b) { return b.text.length > 0; }),
        selects: Array.from(document.querySelectorAll('select')).map(function(s) {
          return { name: s.name, options: Array.from(s.options).map(function(o) { return o.text; }) };
        }),
        body: document.body.innerText.substring(0,1000)
      })
    `,
    returnByValue: true
  });
  console.log('PAGE:', r?.result?.result?.value);
  
  const password = 'CajaFresh_' + Math.random().toString(36).slice(2, 10) + '!';
  console.log('PASSWORD:', password);
  
  const fillR = await c2.send('Runtime.evaluate', {
    expression: `
      (function() {
        var pw = '${password}';
        var result = { filled: [] };
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        
        document.querySelectorAll('input').forEach(function(inp) {
          if (inp.placeholder && inp.placeholder.toLowerCase().includes('name')) {
            nativeSetter.call(inp, 'almacen-cliente');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            result.filled.push('NAME');
          }
          if (inp.type === 'password') {
            nativeSetter.call(inp, pw);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            result.filled.push('PASS');
          }
        });
        
        return JSON.stringify(result);
      })()
    `,
    returnByValue: true
  });
  console.log('FILL:', fillR?.result?.result?.value);
  
  await new Promise(r => setTimeout(r, 1500));
  
  const r2 = await c2.send('Runtime.evaluate', {
    expression: `
      JSON.stringify({
        inputs: Array.from(document.querySelectorAll('input')).map(function(i) {
          return { p: i.placeholder, v: (i.value || '').substring(0,20) };
        }),
        buttons: Array.from(document.querySelectorAll('button')).map(function(b) {
          return { text: b.textContent.trim().substring(0,60), disabled: b.disabled };
        }).filter(function(b) { return b.text.length > 0; })
      })
    `,
    returnByValue: true
  });
  console.log('STATE2:', r2?.result?.result?.value);
  
  c2.ws.close();
}

main();
