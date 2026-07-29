const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const sql = fs.readFileSync('supabase-completo.sql', 'utf8');

async function getPages() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
  });
}

async function connect(wsurl) {
  const ws = new WebSocket(wsurl);
  let id = 1;
  function send(method, params) {
    return new Promise((r) => {
      const mid = id++;
      ws.send(JSON.stringify({ id: mid, method, params }));
      const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === mid) r(m); } catch(e) {} };
      ws.on('message', h);
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 60000);
    });
  }
  return new Promise((r) => {
    ws.on('open', () => r({ ws, send }));
    ws.on('error', (e) => r(null));
  });
}

async function evalJs(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.result?.value;
}

async function main() {
  // Find any project page and navigate to SQL editor
  var pages = await getPages();
  var p = pages.find(p => p.url.includes('gmbqwybdrstmmdbcmitw') && !p.url.includes('stripe'));
  if (!p) { console.log('NO_PAGE'); return; }
  
  var c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  
  // Navigate to SQL editor
  await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/gmbqwybdrstmmdbcmitw/sql/new'");
  console.log('Navigating...');
  await new Promise(r => setTimeout(r, 7000));
  c.ws.close();
  await new Promise(r => setTimeout(r, 2000));
  
  pages = await getPages();
  p = pages.find(p => p.url.includes('/sql/new'));
  if (!p) { 
    console.log('SQL page not found. Available:'); 
    pages.filter(pg => pg.url.includes('gmbqwybdrstmmdbcmitw')).forEach(f => console.log('  ' + f.title + ' | ' + f.url)); 
    return; 
  }
  
  c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  await new Promise(r => setTimeout(r, 3000));
  
  // Enable network capture
  await c.send('Network.enable', {});
  
  // Capture API calls
  var apiCall = null;
  var apiResponse = null;
  c.ws.on('message', (data) => {
    try {
      var msg = JSON.parse(data.toString());
      if (msg.method === 'Network.requestWillBeSent' && msg.params) {
        var req = msg.params.request;
        if (req.url.includes('/api/') && req.method === 'POST' && (req.url.includes('query') || req.url.includes('database') || req.url.includes('sql'))) {
          apiCall = { url: req.url, method: req.method, headers: req.headers, body: req.postData };
        }
      }
      if (msg.method === 'Network.responseReceived' && apiCall && msg.params) {
        var resp = msg.params.response;
        if (resp.url === apiCall.url) {
          apiResponse = resp;
        }
      }
    } catch(e) {}
  });
  
  // Set SQL
  await evalJs(c, `monaco.editor.getModels()[0]?.setValue(${JSON.stringify(sql)})`);
  console.log('SQL set');
  await new Promise(r => setTimeout(r, 2000));
  
  // Click Run
  await evalJs(c, `
    (function() {
      var buttons = document.querySelectorAll('button');
      for (var b of buttons) {
        var txt = b.textContent.trim().toLowerCase();
        if (txt === 'run' || txt.startsWith('run')) {
          b.click();
          return 'clicked';
        }
      }
      return 'not found';
    })()
  `);
  console.log('Clicked Run');
  
  // Wait for network response
  await new Promise(r => setTimeout(r, 10000));
  
  if (apiCall) {
    console.log('API CALL:', apiCall.method, apiCall.url);
    console.log('BODY:', apiCall.body ? apiCall.body.substring(0, 500) : 'N/A');
    console.log('RESPONSE:', apiResponse ? apiResponse.status + ' ' + apiResponse.statusText : 'pending/no response');
  } else {
    console.log('No API call captured. Trying to read the page state...');
    var txt = await evalJs(c, 'document.body.innerText');
    console.log('PAGE:', txt.substring(txt.length - 1000));
  }
  
  c.ws.close();
  process.exit(0);
}

main();
