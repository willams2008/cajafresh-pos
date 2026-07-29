const WebSocket = require('ws');
const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', async () => {
    const pages = JSON.parse(body);
    const p = pages.find(p => p.url.includes('supabase.com/dashboard') && !p.url.includes('stripe') && !p.url.includes('m.stripe'));
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
      // First navigate to the organization's general settings page
      await send('Page.navigate', { url: 'https://supabase.com/dashboard/org/zyxkuofvorykdlnutrlj/general' });
      console.log('Navigated to org general settings...');
      await new Promise(r => setTimeout(r, 4000));

      // Get the org ID from the page (it might be in __NEXT_DATA__)
      const r = await send('Runtime.evaluate', {
        expression: `
          (function() {
            var nextData = document.getElementById('__NEXT_DATA__');
            if (!nextData) return 'NO_NEXT_DATA';
            try {
              var data = JSON.parse(nextData.textContent);
              var props = data.props?.pageProps || {};
              // Look for org info
              return JSON.stringify({
                orgId: props.orgId || props.organizationId || props.org?.id || props.organization?.id || '',
                orgSlug: props.orgSlug || props.organization?.slug || '',
                org: props.org || props.organization || {}
              }).substring(0, 500);
            } catch(e) { return 'PARSE_ERROR'; }
          })()
        `,
        returnByValue: true
      });
      console.log('ORG INFO:', r?.result?.result?.value || 'NONE');

      // Now try to create project using the dashboard's internal Next.js API route
      // The Supabase dashboard uses Next.js API routes under /api/
      const password = 'CajaFresh_' + Math.random().toString(36).slice(2, 10) + '!';
      console.log('Password:', password);
      
      const createR = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            try {
              var token = JSON.parse(localStorage.getItem('supabase.dashboard.auth.token')).access_token;
              
              // Try the Supabase Management API with session token
              var res = await fetch('https://api.supabase.com/v1/projects', {
                method: 'POST',
                headers: {
                  'Authorization': 'Bearer ' + token,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  org_id: 'zyxkuofvorykdlnutrlj',
                  name: 'almacen-cliente',
                  plan: 'free',
                  db_pass: '${password}',
                  region: 'us-east-1'
                })
              });
              var data = await res.text();
              return 'MGMT_API ' + res.status + ': ' + data.substring(0, 1000);
            } catch(e) { return 'ERROR: ' + e.message; }
          })()
        `,
        returnByValue: true,
        awaitPromise: true
      });
      console.log('CREATE RESULT:', createR?.result?.result?.value);

      ws.close();
    });
    ws.on('error', (e) => { console.error('Error:', e.message); });
  });
}).on('error', (e) => { console.error('Error:', e.message); });
