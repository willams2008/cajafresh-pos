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
  // Find any page on the existing project
  var p = pages.find(p => p.url.includes('effgvevvnfzcuvtulyvs') && !p.url.includes('stripe'));
  
  if (!p) {
    console.log('No page on existing project, checking all available...');
    pages.filter(pg => pg.url.includes('supabase.com/dashboard/project')).forEach(f => console.log(f.title.substring(0,60), '|', f.url.substring(0,120)));
    return;
  }
  
  console.log('Using:', p.title.substring(0,60), p.url.substring(0,120));
  
  var c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  
  // Navigate to SQL editor on the existing project
  await evalJs(c, "window.location.href = 'https://supabase.com/dashboard/project/effgvevvnfzcuvtulyvs/sql/new'");
  console.log('Navigating to SQL editor on existing project...');
  await new Promise(r => setTimeout(r, 7000));
  c.ws.close();
  await new Promise(r => setTimeout(r, 2000));
  
  pages = await getPages();
  p = pages.find(p => p.url.includes('sql/new') && p.url.includes('effgvevvnfzcuvtulyvs'));
  if (!p) {
    console.log('SQL page not found. Available:');
    pages.filter(pg => pg.url.includes('effgvevvnfzcuvtulyvs')).forEach(f => console.log(f.title, '|', f.url));
    return;
  }
  
  console.log('Connected to SQL editor');
  c = await connect(p.webSocketDebuggerUrl);
  if (!c) return;
  await new Promise(r => setTimeout(r, 3000));
  
  // Create the missing tables
  var sql = `
-- store_transfers table for Supabase (cloud sync)
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

-- store_purchase_orders table for Supabase (cloud sync)
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_store_transfers_store_id ON store_transfers(store_id);
CREATE INDEX IF NOT EXISTS idx_store_transfers_status ON store_transfers(status);
CREATE INDEX IF NOT EXISTS idx_store_purchase_orders_store_id ON store_purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_store_purchase_orders_status ON store_purchase_orders(status);
  `;
  
  // Set SQL in Monaco
  await evalJs(c, `monaco.editor.getModels()[0]?.setValue(${JSON.stringify(sql)})`);
  console.log('SQL set in editor');
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
  
  // Wait for results
  for (var i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    var txt = await evalJs(c, 'document.body.innerText');
    
    if (txt.includes('Success. No rows returned') || txt.includes('Success, no rows')) {
      console.log('SUCCESS! Tables created.');
      break;
    }
    if (txt.includes('0 rows') && !txt.includes('Click Run')) {
      console.log('Tables created (query completed):');
      var full = await evalJs(c, 'document.body.innerText');
      var relevant = full.includes('Results') ? full.split('Results')[1] : full.substring(full.length - 500);
      console.log(relevant.substring(0, 500));
      break;
    }
    if (txt.includes('ERROR') || txt.includes('error:')) {
      var m = txt.match(/[Ee]rror:[^\\n]+/);
      console.log('Error:', m ? m[0] : txt.substring(0, 500));
      break;
    }
    if (i === 0) console.log('Waiting for results...');
  }
  
  c.ws.close();
  process.exit(0);
}

main();
