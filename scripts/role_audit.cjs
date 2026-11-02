// Walk the app as each role on mock data: nav items, page tabs, editable cells, empty states, errors, screenshots.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http');
const ROOT = path.join(__dirname, '..'); const DIST = path.join(ROOT, 'dist'); const OUT = path.join(ROOT, 'shots', 'roles'); fs.mkdirSync(OUT, { recursive: true });
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pilot_bundle.json')));
const UID = '11111111-1111-1111-1111-111111111111';
function fixture(posPick) {
  const T = JSON.parse(JSON.stringify(base));
  T.app_settings = [['org_weights', { unit: 70, department: 60, division: 50, employee: 30 }], ['hr_scale', { max: 70 }], ['status_thresholds', { on_track: 95, off_track: 70 }], ['bands', [{ name: 'Achieved', min: 100 }, { name: 'Well performed', min: 75 }, { name: 'Partially achieved', min: 40 }, { name: 'Under performed', min: 0 }]], ['current', { fiscal_year: '2026/27', quarter: 2 }], ['status_method', { method: 'pace', grace_pct: 15 }], ['framework', { type: 'okr', labels: {} }],
    ['windows', { insights: ['super_admin', 'group_strategy', 'executive', 'unit_head', 'planning_head', 'finance', 'dept_head', 'div_head'], studio: ['super_admin', 'group_strategy', 'planning_head', 'finance', 'unit_head', 'dept_head', 'div_head'], studio_admin: ['super_admin', 'group_strategy'] }], ['tax_rate', { rate: 30 }], ['work_rules', { activities: 'both' }]].map(([key, value]) => ({ key, value }));
  T.profiles = [{ id: UID, email: 'x@y', full_name: 'Tester' }];
  ['week_reviews', 'scorecards', 'scorecard_items', 'position_claims', 'audit_log', 'kr_month_targets', 'rescopes', 'comments', 'notifications', 'kr_plan_links', 'kpis', 'kpi_values', 'messages', 'fund_months', 'need_schedule', 'cash_actual', 'cash_weekly', 'pmo_projects'].forEach(k => T[k] = []);
  T.strategy_statements = [{ unit_id: T.org_units.find(u => u.kind === 'group').id, vision: 'Empowering organizations, people and communities', mission: 'Maximize shareholder value', values: [{ name: 'Integrity' }] }];
  T.check_ins.forEach((c, i) => { c.created_at = '2026-10-0' + (1 + (i % 9)) + 'T10:00:00Z'; });
  const me = posPick(T); T.positions.forEach(p => { p.user_id = p.id === me.id ? UID : null; });
  // work data around the person
  const d0 = new Date(); const back = (d0.getUTCDay() + 1) % 7; const ws = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() - back)).toISOString().slice(0, 10);
  const orgKr = T.key_results.find(k => { const o = T.objectives.find(x => x.id === k.objective_id); return o && o.org_unit_id === me.org_unit_id; }) || T.key_results.find(k => { const o = T.objectives.find(x => x.id === k.objective_id); return o && o.unit_id === me.unit_id; });
  const obj = orgKr && T.objectives.find(o => o.id === orgKr.objective_id);
  const team = T.positions.filter(p => p.org_unit_id === me.org_unit_id && p.holder_name).slice(0, 5);
  T.deliverables = team.flatMap((p, i) => [{ id: 'd' + i, unit_id: me.unit_id, key_result_id: orgKr?.id, objective_id: obj?.id, owner_position_id: p.id, month: 5, quarter: 2, title: 'Deliverable ' + (i + 1), weight: 50, status: ['planned', 'done', 'accepted', 'returned', 'planned'][i % 5], source: 'plan' },
    { id: 'e' + i, unit_id: me.unit_id, key_result_id: null, objective_id: obj?.id, owner_position_id: p.id, month: 6, quarter: 2, title: 'ERP item ' + (i + 1), status: 'planned', source: 'erp', note: 'From ERP personal OKR: Improve something ' + i }]);
  T.activities = team.flatMap((p, i) => [0, 1].map(j => ({ id: 'a' + i + j, unit_id: me.unit_id, owner_position_id: p.id, week_start: ws, title: 'Activity ' + i + '.' + j, deliverable_id: 'd' + i, status: ['Done', 'Stuck'][j], pct: [100, 20][j], blocker: j ? 'Waiting' : null, created_at: '2026-10-25', updated_at: '2026-10-26' })));
  return { T, me };
}
const PICKS = {
  'team-member': T => T.positions.find(p => p.role === 'employee' && p.holder_name && T.org_units.find(o => o.id === p.org_unit_id)?.kind === 'department' && T.objectives.some(o => o.org_unit_id === p.org_unit_id)),
  'division-head': T => T.positions.find(p => p.role === 'div_head' && p.holder_name),
  'department-head': T => T.positions.find(p => p.role === 'dept_head' && p.holder_name && T.objectives.some(o => o.org_unit_id === p.org_unit_id)),
  'unit-head': T => T.positions.find(p => p.role === 'unit_head' && p.holder_name),
  'planning-head': T => T.positions.find(p => p.role === 'planning_head'),
  'finance': T => T.positions.find(p => p.role === 'finance'),
  'group-strategy': T => T.positions.find(p => p.role === 'group_strategy'),
  'executive': T => T.positions.find(p => p.role === 'executive'),
};
const srv = http.createServer((req, res) => { let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(fs.readFileSync(f)); }).listen(4174);
(async () => {
  const b = await chromium.launch(); const report = [];
  for (const [name, pick] of Object.entries(PICKS)) {
    const { T, me } = fixture(pick); if (!me) { report.push(`## ${name}: no position in data`); continue; }
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); const errors = []; const writes = [];
    await ctx.route(/supabase\.co/, async route => { const u = new URL(route.request().url()); const m = u.pathname.match(/\/rest\/v1\/(.+)/);
      if (u.pathname.includes('/rpc/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '0' });
      if (m && route.request().method() === 'GET') { const rows = T[m[1]] || []; const off = Number(u.searchParams.get('offset') || 0); const lim = Number(u.searchParams.get('limit') || 1000); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(off, off + lim)) }); }
      if (m) { writes.push(route.request().method() + ' ' + m[1]); return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
      if (u.pathname.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: UID, email: 'x@y', aud: 'authenticated' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await ctx.addInitScript(([uid, unit]) => { localStorage.setItem('sb-wvvrntgktelzxggmhkiz-auth-token', JSON.stringify({ access_token: 'x.eyJzdWIiOiJ4In0.x', refresh_token: 'r', token_type: 'bearer', expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000, user: { id: uid, email: 'x@y', aud: 'authenticated' } })); if (unit) localStorage.setItem('wbg.unit', unit); }, [UID, me.unit_id]);
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text().slice(0, 160)); });
    await page.goto('http://localhost:4174/today'); await page.waitForTimeout(900);
    const lines = [`## ${name} — ${me.title} (${me.role}, ${me.level})`];
    const wins = await page.locator('.winsw button').allInnerTexts().catch(() => []); lines.push('windows: ' + (wins.join(', ') || 'Work only'));
    const seen = new Set();
    for (const win of ['Work', ...wins.filter(w => w !== 'Work')]) {
      if (win !== 'Work') { await page.locator('.winsw button', { hasText: win }).click(); await page.waitForTimeout(500); }
      const links = await page.locator('nav a.mod').evaluateAll(as => as.map(a => [a.textContent.trim(), a.getAttribute('href')]));
      lines.push(`${win} nav: ` + links.map(l => l[0]).join(' | '));
      for (const [label, href] of links) { if (seen.has(href)) continue; seen.add(href);
        await page.goto('http://localhost:4174' + href); await page.waitForTimeout(450);
        const tabs = await page.locator('.mainw .tabs button').allInnerTexts().catch(() => []);
        const pages = [[href, '']]; for (const t of tabs.slice(1)) pages.push([href, t]);
        for (const [h, t] of pages) {
          if (t) { await page.locator('.mainw .tabs button', { hasText: t }).first().click().catch(() => {}); await page.waitForTimeout(350); }
          const txt = await page.locator('.mainw').innerText().catch(() => '');
          const editable = await page.locator('.sheet td:not(.ro):not(.rn)').count(); const sheets = await page.locator('.sheet').count();
          const btns = await page.locator('.mainw button.pri').count(); const empties = await page.locator('.mainw .empty').allInnerTexts().catch(() => []);
          const flag = /hit an error|Could not load/.test(txt) || !txt.trim() ? ' **ERROR/EMPTY**' : '';
          lines.push(`- ${label}${t ? ' › ' + t : ''}: sheets ${sheets}, editable cells ${editable}, primary buttons ${btns}${empties.length ? ', empty: ' + empties.map(e => e.slice(0, 70)).join(' / ') : ''}${flag}`);
          await page.screenshot({ path: path.join(OUT, `${name}${h.replace(/[\/?=&]/g, '-')}${t ? '-' + t.replace(/\W+/g, '_') : ''}.png`) });
        }
      }
    }
    if (errors.length) lines.push('errors: ' + [...new Set(errors)].slice(0, 8).join(' || '));
    report.push(lines.join('\n')); await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), report.join('\n\n')); console.log(report.join('\n\n'));
  await b.close(); srv.close();
})();
