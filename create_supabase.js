const WebSocket = require('ws');
const http = require('http');

// Get token from browser
function getToken() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', async () => {
        const pages = JSON.parse(body);
        const p = pages.find(p => p.url.includes('supabase.com') && !p.url.includes('stripe') && p.title.includes('Access Tokens'));
        if (!p) { reject(new Error('Page not found')); return; }
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
            setTimeout(() => { ws.removeListener('message', handler); resolve2(null); }, 3000);
          });
        }
        ws.on('open', async () => {
          const r = await send('Runtime.evaluate', {
            expression: 'try { JSON.parse(localStorage.getItem("supabase.dashboard.auth.token")).access_token } catch(e) { "" }',
            returnByValue: true
          });
          ws.close();
          resolve(r?.result?.result?.value || '');
        });
        ws.on('error', reject);
      });
    }).on('error', reject);
  });
}

async function api(path, options = {}) {
  const token = await getToken();
  if (!token) { console.error('No token'); return; }
  const res = await fetch('https://api.supabase.com' + path, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  return res;
}

async function main() {
  // Step 1: Get orgs
  console.log('Getting organizations...');
  const orgsRes = await api('/v1/organizations');
  const orgs = await orgsRes.json();
  console.log('Orgs:', orgs.map(o => o.name + ' (' + o.id + ')'));

  const orgId = orgs[0]?.id || 'zyxkuofvorykdlnutrlj';
  
  // Step 2: Check existing projects
  console.log('Getting projects...');
  const projectsRes = await api('/v1/projects');
  const projects = await projectsRes.json();
  console.log('Existing projects:', projects.map(p => p.name + ' (' + p.id + ')'));
  
  // Step 3: Create new project
  const projectName = 'almacen-cliente';
  const dbPassword = 'CajaFresh' + Math.random().toString(36).slice(2, 8) + '2026!';
  console.log('Creating project: ' + projectName + '...');
  
  const createRes = await api('/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      org_id: orgId,
      name: projectName,
      plan: 'free',
      db_pass: dbPassword,
      region: 'us-east-1',
      db_version: '15.6.1.116'
    })
  });
  
  const result = await createRes.json();
  console.log('Create result:', JSON.stringify(result, null, 2));
  
  if (result.id) {
    console.log('\n✅ Project created!');
    console.log('Project ID:', result.id);
    console.log('Project Name:', result.name);
    console.log('DB Password:', dbPassword);
    console.log('\nWaiting for project to be ready (60s)...');
    console.log('Check: https://supabase.com/dashboard/project/' + result.id);
  }
}

main().catch(console.error);
