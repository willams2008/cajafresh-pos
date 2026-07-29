const http = require('http');
const WebSocket = require('ws');

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
      setTimeout(() => { ws.removeListener('message', h); r(null); }, 120000);
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
  var pages = await getPages();
  // Use the open new project page to navigate to the EXISTING project SQL editor
  var p = pages.find(p => p.url.includes('project/gmbqwybdrstmmdbcmitw') && !p.url.includes('stripe'));
  if (!p) {
    console.log('NO_PAGE');
    return;
  }
  
  var c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  
  // Navigate to existing project's SQL editor
  await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/effgvevvnfzcuvtulyvs/sql/new'");
  console.log('Navigating to existing project SQL editor...');
  await new Promise(r => setTimeout(r, 7000));
  c.ws.close();
  await new Promise(r => setTimeout(r, 2000));
  
  pages = await getPages();
  p = pages.find(p => p.url.includes('effgvevvnfzcuvtulyvs') && p.url.includes('sql/'));
  if (!p) {
    console.log('SQL page not found. Available:');
    pages.filter(pg => pg.url.includes('effgvevvnfzcuvtulyvs')).forEach(f => console.log(f.title, '|', f.url));
    // Try again with more options
    p = pages.find(p => p.url.includes('effgvevvnfzcuvtulyvs'));
    if (!p) { console.log('EXISTING_PROJECT_NOT_ACCESSIBLE'); return; }
  }
  
  console.log('Connected:', p.title, p.url.substring(0, 120));
  c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  await new Promise(r => setTimeout(r, 4000));
  
  // Check if we're on SQL editor or need to navigate
  var url = await evalJs(c, 'window.location.href');
  if (!url.includes('sql/new') && !url.includes('sql/')) {
    console.log('Not on SQL editor, navigating...');
    await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/effgvevvnfzcuvtulyvs/sql/new'");
    await new Promise(r => setTimeout(r, 7000));
    c.ws.close();
    await new Promise(r => setTimeout(r, 2000));
    pages = await getPages();
    p = pages.find(p => p.url.includes('effgvevvnfzcuvtulyvs') && p.url.includes('sql/'));
    if (!p) { console.log('CANNOT_NAVIGATE_TO_SQL'); return; }
    c = await connect(p.webSocketDebuggerUrl);
    if (!c) return;
    await new Promise(r => setTimeout(r, 4000));
  }
  
  console.log('On SQL editor, running migration...');
  
  var sql = `
CREATE TABLE IF NOT EXISTS store_transfers (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    from_store TEXT,
    to_store TEXT,
    product_id TEXT,
    product_name TEXT,
    quantity REAL DEFAULT 0,
    status TEXT DEFAULT 'PENDING',
    date TEXT,
    timestamp BIGINT,
    cashier_name TEXT,
    notes TEXT,
    po_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_purchase_orders (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    from_store TEXT,
    to_store TEXT,
    status TEXT DEFAULT 'PENDING',
    items_json TEXT,
    total_cost REAL DEFAULT 0,
    notes TEXT,
    date TEXT,
    timestamp BIGINT,
    created_by TEXT,
    approved_by TEXT,
    received_date TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_transfers_store_id ON store_transfers(store_id);
CREATE INDEX IF NOT EXISTS idx_store_transfers_status ON store_transfers(status);
CREATE INDEX IF NOT EXISTS idx_store_purchase_orders_store_id ON store_purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_store_purchase_orders_status ON store_purchase_orders(status);
  `;
  
  await evalJs(c, `monaco.editor.getModels()[0]?.setValue(${JSON.stringify(sql)})`);
  console.log('SQL set');
  await new Promise(r => setTimeout(r, 2000));
  
  await evalJs(c, `
    (function() {
      var buttons = document.querySelectorAll('button');
      for (var b of buttons) {
        var txt = b.textContent.trim().toLowerCase();
        if (txt === 'run' || txt.startsWith('run')) { b.click(); return; }
      }
    })()
  `);
  console.log('Clicked Run');
  
  for (var i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    var txt = await evalJs(c, 'document.body.innerText');
    if (txt.includes('Success. No rows returned') || txt.includes('Success, no rows')) {
      console.log('SUCCESS!');
      break;
    }
    if (txt.includes('0 rows') && !txt.includes('Click Run')) {
      console.log('Done!');
      var full = await evalJs(c, 'document.body.innerText');
      var rel = full.includes('Results') ? full.split('Results')[1] : full.substring(full.length - 400);
      console.log(rel.substring(0, 400));
      break;
    }
    if (txt.includes('ERROR') || txt.includes('error:')) {
      console.log('Error:', txt.match(/[Ee]rror:[^\\n]+/)?.[0] || txt.substring(0, 500));
      break;
    }
    if (i === 0) console.log('Waiting...');
  }
  
  c.ws.close();
  process.exit(0);
}

main();
