// For each role and each spreadsheet page: try to edit every editable-looking (white) cell and report the ones that do not take the edit.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http');
const { fixture, PICKS, UID } = require('./role_audit.cjs');
const ROOT = path.join(__dirname, '..'); const DIST = path.join(ROOT, 'dist');
const PAGES = ['/plan?tab=targets', '/plan?tab=deliverables', '/plan?tab=week', '/record?tab=week', '/record?tab=deliverables', '/record?tab=krs', '/record?tab=finance'];
const srv = http.createServer((req, res) => { let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(fs.readFileSync(f)); }).listen(4175);
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const name of ['team-member', 'department-head', 'finance', 'group-strategy']) {
    const { T, me } = fixture(PICKS[name]);
    // weekly rows for "this week" owned by me so the Record sheet has rows
    const d0 = new Date(); const back = (d0.getUTCDay() + 1) % 7; const ws = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() - back)).toISOString().slice(0, 10);
    T.activities.push({ id: 'mine1', unit_id: me.unit_id, owner_position_id: me.id, week_start: ws, title: 'My planned task', kind: 'Task', status: 'In progress', pct: 30, created_at: '2026-10-25', updated_at: '2026-10-26' }, { id: 'mine2', unit_id: me.unit_id, owner_position_id: me.id, week_start: ws, title: 'My unplanned task', kind: 'Unplanned', unplanned: true, status: 'Not started', pct: 0 });
    const cm = Math.min(12, Math.max(1, (() => { const n = new Date(); const s = new Date(Date.UTC(2026, 6, 8)); return Math.floor((n - s) / (30.4 * 864e5)) + 1; })()));
    T.deliverables.push({ id: 'dm', unit_id: me.unit_id, key_result_id: T.deliverables[0]?.key_result_id, objective_id: T.deliverables[0]?.objective_id, owner_position_id: me.id, month: cm, quarter: Math.ceil(cm / 3), title: 'My deliverable this month', status: 'planned', source: 'plan', weight: 100 });
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
    await ctx.route(/supabase\.co/, async route => { const u = new URL(route.request().url()); const m = u.pathname.match(/\/rest\/v1\/(.+)/);
      if (u.pathname.includes('/rpc/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '0' });
      if (m && route.request().method() === 'GET') { const rows = T[m[1]] || []; const off = Number(u.searchParams.get('offset') || 0); const lim = Number(u.searchParams.get('limit') || 1000); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(off, off + lim)) }); }
      if (m) return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      if (u.pathname.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: UID, email: 'x@y', aud: 'authenticated' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await ctx.addInitScript(([uid, unit]) => { localStorage.setItem('sb-wvvrntgktelzxggmhkiz-auth-token', JSON.stringify({ access_token: 'x.eyJzdWIiOiJ4In0.x', refresh_token: 'r', token_type: 'bearer', expires_in: 360000, expires_at: Math.floor(Date.now() / 1000) + 360000, user: { id: uid, email: 'x@y', aud: 'authenticated' } })); localStorage.setItem('wbg.unit', unit); }, [UID, me.unit_id]);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    out.push(`## ${name} (${me.title})`);
    for (const url of name === 'group-strategy' ? ['/studio/resources', '/studio/rescope', '/studio/projects', '/record?tab=finance'] : PAGES) {
      await page.goto('http://localhost:4175' + url); await page.waitForTimeout(700);
      if (!(await page.locator('.sheet').count())) { out.push(`- ${url}: no sheet`); continue; }
      const heads = await page.locator('.sheet thead th').allInnerTexts();
      const rowsN = Math.min(await page.locator('.sheet tbody tr:not(.hdr-row):not(.tot)').count(), 3);
      const res = {}; let editable = 0, failed = 0;
      for (let r = 0; r < rowsN; r++) {
        const row = page.locator('.sheet tbody tr:not(.hdr-row):not(.tot)').nth(r); const cells = row.locator('td');
        const n = await cells.count();
        for (let c = 1; c < n; c++) { const td = cells.nth(c); const cls = (await td.getAttribute('class')) || ''; if (cls.includes('ro') || cls.includes('rn')) continue;
          const col = heads[c] || String(c); editable++;
          const sel = td.locator('select');
          if (await sel.count()) { const opts = await sel.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean)); if (!opts.length) { res[col] = 'select has no options'; failed++; continue; }
            const before = await sel.inputValue(); const pick = opts.find(o => o !== before) || opts[0]; await sel.selectOption(pick); await page.waitForTimeout(60); const after = await td.locator('select').inputValue().catch(() => '');
            if (after !== pick) { res[col] = 'select did not change'; failed++; } else res[col] = res[col] || 'ok'; continue; }
          await td.click(); await page.waitForTimeout(60); const inp = td.locator('input');
          if (!(await inp.count())) { res[col] = 'click did not open an input'; failed++; continue; }
          const type = await inp.getAttribute('type'); await inp.fill(type === 'date' ? '2026-11-20' : /%|Target|Weight|Actual|Achieved|complete|target|actual|Year|Q\d|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Opening|Cash|Closing/.test(col) ? '42' : 'edited'); await page.keyboard.press('Tab'); await page.waitForTimeout(60);
          const txt = await td.innerText(); if (!/edited|42|2026-11-20/.test(txt)) { res[col] = 'typed value not kept: "' + txt.slice(0, 20) + '"'; failed++; } else res[col] = res[col] || 'ok';
        }
      }
      const saveBar = await page.locator('.savebar').count();
      out.push(`- ${url}: ${rowsN} rows, ${editable} editable cells, ${failed} failed, save bar ${saveBar ? 'shown' : 'NOT shown'}; ` + Object.entries(res).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v}`).join('; '));
      const ro = await page.locator('.sheet thead th').evaluateAll(() => null);
    }
    if (errs.length) out.push('errors: ' + errs.slice(0, 5).join(' | '));
    await ctx.close();
  }
  console.log(out.join('\n')); await b.close(); srv.close();
})();
