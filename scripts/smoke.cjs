// Smoke test against a mocked Supabase (the container cannot reach supabase.co).
// Serves dist/, answers REST reads from the pilot bundle, and visits every page as several roles.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const DIST = path.join(ROOT, 'dist');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pilot_bundle.json')));
const UID = '11111111-1111-1111-1111-111111111111';
const settings = [['org_weights', { unit: 70, department: 60, division: 50, employee: 30 }], ['hr_scale', { max: 70 }], ['status_thresholds', { on_track: 95, off_track: 70 }],
  ['bands', [{ name: 'Achieved', min: 100 }, { name: 'Well performed', min: 75 }, { name: 'Partially achieved', min: 40 }, { name: 'Under performed', min: 0 }]], ['current', { fiscal_year: '2026/27', quarter: 2 }]].map(([key, value]) => ({ key, value }));
T.app_settings = settings; T.profiles = [{ id: UID, email: 'srflhb22@gmail.com', full_name: 'Suhay' }];
T.positions.forEach(p => { if (p.role === 'super_admin') p.user_id = UID; });
T.check_ins.forEach((c, i) => { c.created_at = '2026-10-0' + (1 + (i % 9)) + 'T10:00:00Z'; });
T.rescopes = []; T.deliverables = []; T.activities = []; T.comments = []; T.notifications = []; T.kr_plan_links = []; T.scorecards = []; T.scorecard_items = []; T.kpis = []; T.kpi_values = [];
const srv = http.createServer((req, res) => { let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(fs.readFileSync(f)); }).listen(4173);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  await ctx.route(/supabase\.co/, async route => {
    const u = new URL(route.request().url()); const m = u.pathname.match(/\/rest\/v1\/(.+)/);
    if (u.pathname.includes('/rpc/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '0' });
    if (m && route.request().method() === 'GET') { const rows = T[m[1]] || []; const off = Number((u.searchParams.get('offset') || 0)); const lim = Number(u.searchParams.get('limit') || 1000); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(off, off + lim)) }); }
    if (m) return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    if (u.pathname.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: UID, email: 'srflhb22@gmail.com', aud: 'authenticated' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.addInitScript(([uid]) => { localStorage.setItem('sb-wvvrntgktelzxggmhkiz-auth-token', JSON.stringify({ access_token: 'x.eyJzdWIiOiJ4In0.x', refresh_token: 'r', token_type: 'bearer', expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000, user: { id: uid, email: 'srflhb22@gmail.com', aud: 'authenticated' } })); }, [UID]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  const routes = ['/home', '/work', '/goals/map', '/goals/quarter', '/goals/group', '/plan/calendar', '/plan/okr', '/plan/revenue', '/plan/budget', '/plan/resources', '/plan/rescope', '/performance/org', '/performance/people', '/reports', '/settings/rules', '/settings/people', '/settings/import'];
  const units = T.org_units.filter(u => u.kind === 'unit' && u.pilot);
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  for (const un of units) {
    await page.goto('http://localhost:4173/home'); await page.evaluate(id => localStorage.setItem('wbg.unit', id), un.id);
    for (const r of routes) {
      await page.goto('http://localhost:4173' + r); await page.waitForTimeout(r === '/home' ? 900 : 350);
      const t = await page.locator('main').innerText().catch(() => '');
      if (/hit an error|Could not load/.test(t) || !t) errors.push(`${un.code} ${r}: empty or error`);
      if (['wagwago-electric', 'niyat-consultancy'].includes(un.code) || r === '/plan/resources') await page.screenshot({ path: path.join(ROOT, 'shots', `${un.code}${r.replace(/\//g, '-')}.png`), fullPage: false });
    }
  }
  // reports cash flow tab & role preview
  await page.evaluate(id => localStorage.setItem('wbg.unit', id), units[0].id);
  await page.goto('http://localhost:4173/reports'); await page.waitForTimeout(400); await page.getByRole('button', { name: 'Cash flow' }).click(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'cashflow.png') });
  const emp = T.positions.find(p => p.role === 'employee' && p.holder_name);
  await page.goto('http://localhost:4173/home'); await page.waitForTimeout(500);
  await page.selectOption('.sbot select', emp.id); await page.waitForTimeout(400); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-home.png') });
  const nav = await page.locator('nav').innerText(); console.log('employee nav:', nav.replace(/\n/g, ' | '));
  await page.goto('http://localhost:4173/performance'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-perf.png') });
  // mobile
  await page.setViewportSize({ width: 390, height: 840 }); await page.goto('http://localhost:4173/goals/map'); await page.waitForTimeout(400); await page.screenshot({ path: path.join(ROOT, 'shots', 'mobile-map.png') });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); console.log('mobile scrollWidth', sw);
  console.log(errors.length ? errors.slice(0, 30).join('\n') : 'NO ERRORS');
  await b.close(); srv.close();
})();
