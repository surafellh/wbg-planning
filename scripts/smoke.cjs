// Smoke test against a mocked Supabase (the container cannot reach supabase.co).
// Serves dist/, answers REST reads from the pilot bundle, and visits every page as several roles.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const DIST = path.join(ROOT, 'dist');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pilot_bundle.json')));
const UID = '11111111-1111-1111-1111-111111111111';
const settings = [['org_weights', { unit: 70, department: 60, division: 50, employee: 30 }], ['hr_scale', { max: 70 }], ['status_thresholds', { on_track: 95, off_track: 70 }],
  ['bands', [{ name: 'Achieved', min: 100 }, { name: 'Well performed', min: 75 }, { name: 'Partially achieved', min: 40 }, { name: 'Under performed', min: 0 }]], ['current', { fiscal_year: '2026/27', quarter: 2 }], ['status_method', { method: 'pace', grace_pct: 15 }], ['framework', { type: 'okr', labels: {} }], ['windows', { insights: ['super_admin','group_strategy','executive','unit_head','planning_head','finance','dept_head','div_head'], studio: ['super_admin','group_strategy','planning_head','finance','unit_head'], studio_admin: ['super_admin','group_strategy'] }]].map(([key, value]) => ({ key, value }));
T.app_settings = settings; T.profiles = [{ id: UID, email: 'srflhb22@gmail.com', full_name: 'Suhay' }];
T.positions.forEach(p => { if (p.role === 'super_admin') p.user_id = UID; });
T.check_ins.forEach((c, i) => { c.created_at = '2026-10-0' + (1 + (i % 9)) + 'T10:00:00Z'; });
T.objectives.forEach(o => { const ow = T.positions.find(p => p.id === o.owner_position_id); if (ow && ow.role === 'employee') o.level = 'individual'; }); T.week_reviews=[]; T.scorecards=[]; T.scorecard_items=[]; T.position_claims=[]; T.audit_log=[]; T.kr_month_targets=[]; T.strategy_statements=[{unit_id:T.org_units.find(u=>u.kind==='group').id,vision:'Empowering organizations, people and communities',mission:'Committed to maximizing shareholders value',values:[{name:'Innovation',text:'x'},{name:'Integrity'}],period:'2025/26 – 2029/30'}];
T.rescopes = []; T.deliverables = []; T.activities = [];
{ const adm = T.positions.find(p => p.role === 'super_admin'); const ee = T.org_units.find(u => u.code === 'wagwago-electric'); const kr = T.key_results[0];
  const team = T.positions.filter(p => p.unit_id === ee.id && p.holder_name).slice(0, 4);
  const d0 = new Date(); const back = (d0.getUTCDay() + 1) % 7; const ws = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() - back)).toISOString().slice(0, 10);
  T.deliverables = team.map((p, i) => ({ id: 'd' + i, unit_id: ee.id, key_result_id: kr.id, owner_position_id: p.id, month: 4, title: 'Deliverable ' + (i + 1), weight: 25, status: ['planned', 'done', 'accepted', 'returned'][i], created_at: '2026-10-20' }));
  T.activities = team.flatMap((p, i) => [0, 1, 2].map(j => ({ id: 'a' + i + j, unit_id: ee.id, owner_position_id: p.id, week_start: ws, title: 'Activity ' + i + '.' + j, deliverable_id: j < 2 ? 'd' + i : null, status: ['Done', 'In progress', 'Stuck'][j], pct: [100, 50, 20][j], blocker: j === 2 ? 'Waiting for LC approval' : null, created_at: '2026-10-25', updated_at: '2026-10-26' })));
  T.activities.push({ id: 'am', unit_id: adm.unit_id, owner_position_id: adm.id, week_start: ws, title: 'Review Q2 OKR check-ins', status: 'In progress', pct: 40, created_at: '2026-10-25', updated_at: '2026-10-26' });
} T.comments = []; T.notifications = []; T.messages = []; T.fund_months = []; T.need_schedule = [];
{ const ee = T.org_units.find(u => u.code === 'wagwago-electric');
  T.cash_actual = [1, 2, 3, 4].map(m => ({ unit_id: ee.id, fiscal_year: '2026/27', month: m, opening: 1e7 + m * 1e5, inflow: 5e6, outflow: 4.6e6, closing: 1e7 + (m + 1) * 1e5 }));
  T.cash_weekly = ['2026-10-03', '2026-10-10', '2026-10-17'].flatMap(w => ['in', 'out'].map(d => ({ unit_id: ee.id, week_start: w, direction: d, planned: 1e6, actual: d === 'in' ? 1.2e6 : 9e5 })));
  T.pmo_projects = [{ id: 'pp1', unit_id: ee.id, code: 'P-01', name: 'Substation upgrade', status: 'In progress', rag: 'Amber', progress_pct: 45, budget: 5e6, spent: 2e6, manager: 'A. B.' }]; }
T.app_settings.push({ key: 'tax_rate', value: { rate: 30 } }, { key: 'work_rules', value: { activities: 'both', deliverable_lock: 'month_start' } }); T.kr_plan_links = []; T.scorecards = []; T.scorecard_items = []; T.kpis = []; T.kpi_values = [];
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
  const routes = ['/today', '/strategy', '/plan', '/plan?tab=deliverables', '/plan?tab=activities', '/record', '/record?tab=deliverables', '/record?tab=krs', '/record?tab=fin', '/goals/new', '/inbox', '/me', '/insights/projects', '/studio/projects', '/studio/backup', '/insights/overview', '/insights/strategy', '/insights/map', '/insights/alignment', '/insights/people-work', '/insights/performance', '/insights/people', '/insights/reports', '/insights/reports?tab=okr', '/insights/reports?tab=org', '/insights/reports?tab=work', '/insights/reports?tab=fin', '/insights/group', '/studio/monitor', '/studio/strategy', '/studio/okr', '/studio/targets', '/studio/revenue', '/studio/budget', '/studio/resources', '/studio/rescope', '/studio/calendar', '/studio/scorecards', '/studio/framework', '/studio/people', '/studio/import', '/studio/audit'];
  const units = T.org_units.filter(u => u.kind === 'unit' && u.pilot);
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  for (const un of units) {
    await page.goto('http://localhost:4173/home'); await page.evaluate(id => localStorage.setItem('wbg.unit', id), un.id);
    for (const r of routes) {
      await page.goto('http://localhost:4173' + r); await page.waitForTimeout(r === '/home' ? 900 : 350);
      const t = await page.locator('.mainw').innerText().catch(() => '');
      if (/hit an error|Could not load/.test(t) || !t.trim()) errors.push(`${un.code} ${r}: empty or error`);
      if (['wagwago-electric', 'niyat-consultancy'].includes(un.code) || r === '/plan/resources') await page.screenshot({ path: path.join(ROOT, 'shots', `${un.code}${r.replace(/[\/?=]/g, '-')}.png`), fullPage: false });
    }
  }
  await page.evaluate(id => localStorage.setItem('wbg.unit', id), units[0].id);
  await page.goto('http://localhost:4173/studio/okr'); await page.waitForTimeout(500); await page.getByRole('button', { name: '+ Key result' }).first().click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'By month' }).click(); await page.getByRole('button', { name: 'Ramp up' }).click().catch(()=>{}); await page.waitForTimeout(200); await page.screenshot({ path: path.join(ROOT, 'shots', 'kr-modal.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await page.goto('http://localhost:4173/insights/performance'); await page.waitForTimeout(500); await page.locator('.orgn').nth(1).click(); await page.waitForTimeout(400); await page.screenshot({ path: path.join(ROOT, 'shots', 'org-drawer.png') });
  
  // reports cash flow tab & role preview
  await page.evaluate(id => localStorage.setItem('wbg.unit', id), units[0].id);
  await page.goto('http://localhost:4173/insights/reports?tab=fin'); await page.waitForTimeout(400); await page.selectOption('select[aria-label="Financial report"]', 'cf'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'cashflow.png') });
  for (const v of ['mis', 'co', 'cos', 'wcf']) { await page.selectOption('select[aria-label="Financial report"]', v); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'fin-' + v + '.png') }); }
  await page.goto('http://localhost:4173/insights/reports?tab=org'); await page.waitForTimeout(400); await page.mouse.wheel(0, 1500); await page.waitForTimeout(200); await page.screenshot({ path: path.join(ROOT, 'shots', 'org-people.png') });
  await page.goto('http://localhost:4173/today'); await page.waitForTimeout(300); await page.locator('.searchbtn').first().click(); await page.keyboard.type('revenue'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'search.png') }); await page.keyboard.press('Escape');
  const emp = T.positions.find(p => p.role === 'employee' && p.holder_name);
  await page.goto('http://localhost:4173/today'); await page.waitForTimeout(500);
  const optVal = await page.$eval('.sbot select', el => [...el.options].find(o => o.textContent.includes('team member')).value); await page.selectOption('.sbot select', optVal); await page.waitForTimeout(400); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-home.png') });
  const nav = await page.locator('nav').innerText(); console.log('employee nav:', nav.replace(/\n/g, ' | '));
  await page.goto('http://localhost:4173/me'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-perf.png') }); await page.goto('http://localhost:4173/goals/new'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-wizard.png') }); await page.goto('http://localhost:4173/strategy'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-strategy.png'), fullPage: true }); await page.goto('http://localhost:4173/plan'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(ROOT, 'shots', 'employee-plan.png') });
  // mobile
  await page.setViewportSize({ width: 390, height: 840 }); await page.goto('http://localhost:4173/today'); await page.waitForTimeout(400); await page.screenshot({ path: path.join(ROOT, 'shots', 'mobile-map.png') });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth); console.log('mobile scrollWidth', sw);
  console.log(errors.length ? errors.slice(0, 30).join('\n') : 'NO ERRORS');
  await b.close(); srv.close();
})();
