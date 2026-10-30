"""Builds the pilot data bundle (JSON, one list of rows per table) from:
   - the ERP Corporate Planning dataset (OKRs, key results, goals, employees)
   - the strategy documents (pillars, goal-to-pillar mapping)
   - the parsed unit annual-plan workbooks (seed.json)
IDs are deterministic (uuid5) so the bundle can be re-loaded safely."""
import json, re, sys, uuid, math
import pandas as pd

ERP, SEED, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
NS = uuid.UUID('6f1c1d2e-8a51-4c0e-9a57-7d2b1e0c0a11')
def uid(*p): return str(uuid.uuid5(NS, '|'.join(str(x) for x in p)))
def clean(s): return re.sub(r'\s+', ' ', str(s)).strip() if s is not None and not (isinstance(s, float) and math.isnan(s)) else None
def num(v):
    try:
        f = float(v); return None if math.isnan(f) else f
    except Exception: return None

T = {k: [] for k in ['org_units','positions','group_pillars','group_goals','unit_pillars','unit_goals','objectives','key_results','kr_targets','check_ins','projects','plan_lines','actuals','cash_items','cash_values','activity_plan_lines','funds','need_priority','plan_status']}
FY = '2026/27'

# ---------------- organisation ----------------
UNITS = {
  'wagwago-electric': dict(name='Wagwago Electric', unit_type='business', revenue_model='product', roots=['CEO Office / COO- Manufacturing Sector']),
  'niyat-consultancy': dict(name='Niyat Consultancy', unit_type='business', revenue_model='project', roots=['CEO / Deputy General Manager', 'CEO']),
  'hrm': dict(name='HR and General Service', unit_type='function', revenue_model='none', roots=['CEO Office / HR and General Service']),
  'csco': dict(name='Corporate Supply Chain', unit_type='function', revenue_model='none', roots=['CEO Office / Corporate Supply Chain Office']),
}
NICE = {'Finanace': 'Finance', 'IT Infrastractuer': 'IT Infrastructure', 'Account Managment': 'Account Management', 'Finance -E': 'Finance', 'Design & Engineering-E': 'Design & Engineering', 'Warehouse-N': 'Warehouse', 'Treasury-E': 'Treasury'}
SKIP_DEPTS = {'Other Department'}
group_id = uid('org', 'group')
T['org_units'].append(dict(id=group_id, code='group', name='Wagwago Business Group', kind='group', unit_type=None, parent_id=None, unit_id=None, revenue_model='none', erp_name='WAGWAGO TRADING PLC', sort=0, pilot=True))
gso = uid('org', 'group-strategy-office')
T['org_units'].append(dict(id=gso, code='group-strategy-office', name='Group Strategy Office', kind='unit', unit_type='function', parent_id=group_id, unit_id=gso, revenue_model='none', erp_name='CEO Office / Planning', sort=99, pilot=False))
orgs = {}  # (unit, path-tuple) -> id
for i, (code, u) in enumerate(UNITS.items()):
    oid = uid('org', code)
    T['org_units'].append(dict(id=oid, code=code, name=u['name'], kind='unit', unit_type=u['unit_type'], parent_id=group_id, unit_id=oid, revenue_model=u['revenue_model'], erp_name=u['roots'][0], sort=i + 1, pilot=True))
    orgs[(code, ())] = oid

def norm_path(d):
    d = clean(d) or ''
    d = re.sub(r'\s*/\s*', ' / ', d).replace('  ', ' ')
    return d

def place(path, company=None):
    """Return (unit code, path tuple below unit root) or None."""
    p = norm_path(path)
    for code, u in UNITS.items():
        if code == 'niyat-consultancy' and not (company or '').startswith('NIYAT'):
            continue
        for r in u['roots']:
            if p == r or p.startswith(r + ' /'):
                rest = [NICE.get(x.strip(), x.strip()) for x in p[len(r):].split('/') if x.strip()]
                rest = [x for x in rest if x not in SKIP_DEPTS]
                return code, tuple(rest[:2])
    return None

def org_of(code, rest):
    key = (code, rest)
    if key in orgs: return orgs[key]
    parent = org_of(code, rest[:-1])
    oid = uid('org', code, *rest)
    T['org_units'].append(dict(id=oid, code=None, name=rest[-1], kind='department' if len(rest) == 1 else 'division', unit_type=None, parent_id=parent, unit_id=orgs[(code, ())], revenue_model='none', erp_name=' / '.join(rest), sort=len(T['org_units']), pilot=True))
    orgs[key] = oid
    return oid

X = pd.read_excel(ERP, sheet_name=None)
O = X['OKRs']; O = O[O.fiscal_year.astype(str).str.contains('2026')].copy()
K = X['KeyResults']; E = X['Employees']; G = X['Goals']

# people: active employees in pilot departments + anyone owning a pilot OKR
people = {}  # name -> (code, rest)
for _, r in E[E.active.astype(str) == 'Y'].iterrows():
    pl = place(r.hr_department, str(r.company))
    if pl: people[clean(r['name'])] = pl
O['pl'] = [place(d, str(c)) for d, c in zip(O.okr_department, O.company)]
P = O[O.pl.notna()].copy()
for _, r in P.iterrows():
    people.setdefault(clean(r.employee), r.pl)
# supervisor counts -> heads
subs = {}
for _, r in P.iterrows():
    s = clean(r.supervisor)
    if s and s != clean(r.employee): subs.setdefault(s, set()).add(clean(r.employee))
for _, r in E.iterrows():
    pass
heads = {}
for name, (code, rest) in people.items():
    n = len(subs.get(name, ()))
    key = (code, rest)
    if n and (key not in heads or n > heads[key][1]): heads[key] = (name, n)

ROLE_BY_LEVEL = {0: 'unit_head', 1: 'dept_head', 2: 'div_head'}
LEVEL = {0: 'unit', 1: 'department', 2: 'division'}
def special_role(code, rest, base):
    if base == 'dept_head' and rest and re.search(r'Planning', rest[0]): return 'planning_head'
    if base == 'dept_head' and rest and re.search(r'^Financ', rest[0]): return 'finance'
    return base
pos_of = {}
for name, (code, rest) in sorted(people.items(), key=lambda x: (x[1][0], len(x[1][1]), x[1][1], x[0])):
    oid = org_of(code, rest)
    is_head = heads.get((code, rest), (None,))[0] == name
    role = special_role(code, rest, ROLE_BY_LEVEL[len(rest)]) if is_head else 'employee'
    lvl = LEVEL[len(rest)] if is_head else 'employee'
    title = ('Head of ' + rest[-1]) if (is_head and rest) else ('General manager · ' + UNITS[code]['name'] if is_head else 'Team member · ' + (rest[-1] if rest else UNITS[code]['name']))
    pid = uid('pos', code, name)
    pos_of[name] = pid
    T['positions'].append(dict(id=pid, org_unit_id=oid, unit_id=orgs[(code, ())], title=title, level=lvl, role=role, holder_name=name, erp_employee=name, status='Filled', sort=len(T['positions'])))
# vacant head positions where no head was found
for (code, rest), oid in list(orgs.items()):
    if (code, rest) not in heads:
        pid = uid('pos', code, 'head', *rest)
        T['positions'].append(dict(id=pid, org_unit_id=oid, unit_id=orgs[(code, ())], title=('Head of ' + rest[-1]) if rest else 'General manager · ' + UNITS[code]['name'], level=LEVEL[len(rest)], role=special_role(code, rest, ROLE_BY_LEVEL[len(rest)]), holder_name=None, status='Vacant', sort=len(T['positions'])))
        heads[(code, rest)] = (None, 0, pid)
# group-level positions
T['positions'] += [
  dict(id=uid('pos', 'group', 'corporate-planning'), org_unit_id=gso, unit_id=gso, title='Corporate Planning', level='group', role='super_admin', holder_name='Suhay', email='surafel.h@wagwagoelectric.com', status='Filled', sort=0),
  dict(id=uid('pos', 'group', 'cso'), org_unit_id=gso, unit_id=gso, title='Chief Strategy Officer', level='group', role='group_strategy', holder_name=None, status='Vacant', sort=1),
  dict(id=uid('pos', 'group', 'ceo'), org_unit_id=group_id, unit_id=None, title='Group CEO', level='group', role='executive', holder_name=None, status='Vacant', sort=2),
]

# ---------------- strategy ----------------
GP = [('I', 'Capital Growth & Investment Enablement', [1, 2]), ('II', 'Innovation & Technology Leadership', [3, 4, 5, 6]),
      ('III', 'Operational Excellence', [7, 8, 9, 88, 99, 120, 216]), ('IV', 'Customer Empowerment', [10, 11, 12, 13]),
      ('V', 'Talent, Leadership & Organizational Capability', [14, 15, 16, 17]), ('VI', 'Strategic Partnerships & Ecosystem Development', [18, 19, 20, 21]),
      ('VII', 'Sustainable Growth & Impact', [22, 23, 24, 25])]
goal_name = {int(r.goal_id): clean(r.goal) for _, r in G.iterrows()}
goal_w = {int(r.goal_id): num(r.weight) for _, r in G.iterrows()}
ggid = {}
for i, (c, n, gs) in enumerate(GP):
    pid = uid('gp', c); T['group_pillars'].append(dict(id=pid, code=c, name=n, sort=i))
    for j, g in enumerate(gs):
        if g not in goal_name: continue
        ggid[g] = uid('gg', g)
        T['group_goals'].append(dict(id=ggid[g], pillar_id=pid, code=f'{c}.{j+1}', name=goal_name[g], erp_goal_id=g, weight=goal_w.get(g), sort=j))
UP = {
 'wagwago-electric': [('I', 'Operational Excellence'), ('II', 'People, Leadership & Culture'), ('III', 'Innovation, Digital & Product Leadership'), ('IV', 'Financial Resilience & Investment Readiness'), ('V', 'Market Growth & Sustainability'), ('VI', 'Sustainability & Environmental Leadership')],
 'niyat-consultancy': [('1', 'Innovation & Digital Transformation'), ('2', 'Client Success & Value Creation'), ('3', 'Operational Excellence & Capacity Building'), ('4', 'Sustainable Growth & Market Leadership'), ('5', 'Strategic Partnership & Ecosystem Development'), ('6', 'Capital Market Ecosystem Integration')],
}
UG = {  # erp goal -> (unit pillar code, group goal)
 'wagwago-electric': {367: ('I', 8), 368: ('I', 216), 369: ('II', 15), 370: ('IV', 22), 371: ('V', 10), 380: ('III', 6)},
 'niyat-consultancy': {196: ('4', 22), 200: ('4', 22), 201: ('3', 8), 202: ('3', 8), 203: ('2', 10), 204: ('4', 216), 205: ('3', 16), 379: ('1', 5)},
}
ugid = {}   # (unit, erp goal) -> id
for code, pl in UP.items():
    u = orgs[(code, ())]
    for i, (c, n) in enumerate(pl):
        T['unit_pillars'].append(dict(id=uid('up', code, c), unit_id=u, code=c, name=n, sort=i))
    for j, (g, (pc, gg)) in enumerate(UG[code].items()):
        ugid[(code, g)] = uid('ug', code, g)
        T['unit_goals'].append(dict(id=ugid[(code, g)], pillar_id=uid('up', code, pc), unit_id=u, code=f'{pc}.{j+1}', name=re.sub(r'^WWE\s*-\s*', '', goal_name.get(g, str(g))).strip(), group_goal_id=ggid.get(gg), erp_goal_id=g, weight=goal_w.get(g), link_confirmed=False, sort=j))
# function units serve Group goals directly: give them a mirror pillar/goal for each Group goal their OKRs use
name_to_goal = {v: k for k, v in goal_name.items()}
def unit_goal_for(code, gname):
    g = name_to_goal.get(clean(gname))
    if g is None: return None
    if (code, g) in ugid: return ugid[(code, g)]
    if code in UP: return None
    if g not in ggid: return None
    pil = next(p for p in GP if g in p[2])
    up = uid('up', code, pil[0])
    if not any(x['id'] == up for x in T['unit_pillars']):
        T['unit_pillars'].append(dict(id=up, unit_id=orgs[(code, ())], code=pil[0], name=pil[1], description='Group pillar', sort=GP.index(pil)))
    ugid[(code, g)] = uid('ug', code, g)
    T['unit_goals'].append(dict(id=ugid[(code, g)], pillar_id=up, unit_id=orgs[(code, ())], code=next(x['code'] for x in T['group_goals'] if x['erp_goal_id'] == g), name=goal_name[g], group_goal_id=ggid[g], erp_goal_id=g, link_confirmed=True, sort=g))
    return ugid[(code, g)]

# ---------------- OKRs ----------------
STATE = {'draft': 'Draft', 'review': 'Submitted', 'approved': 'Approved', 'under_execution': 'Approved'}
okr_ids = set(P.okr_id.astype(int))
oid_of = {int(r.okr_id): uid('obj', int(r.okr_id)) for _, r in P.iterrows()}
for _, r in P.iterrows():
    code, rest = r.pl
    e = clean(r.employee)
    pc, prest = people.get(e, (code, rest))
    # objective sits where its owner sits
    org = orgs.get((code, prest)) or org_of(code, prest)
    parent = int(r.parent_okr_id) if num(r.parent_okr_id) is not None and int(r.parent_okr_id) in okr_ids else None
    ug = None if parent else unit_goal_for(code, r.direct_strategic_goal)
    T['objectives'].append(dict(id=oid_of[int(r.okr_id)], unit_id=orgs[(code, ())], org_unit_id=org, fiscal_year=FY, level=LEVEL[len(prest)],
        unit_goal_id=ug, parent_objective_id=oid_of[parent] if parent else None,
        text=re.sub(r'\s*20\d\d/\d\d\.?\s*$', '', clean(r.okr_name)), weight_to_parent=num(r.weight_to_parent) or num(r.weight_to_goal),
        owner_position_id=pos_of.get(e), status=STATE.get(str(r.state), 'Draft'), erp_okr_id=int(r.okr_id), sort=int(r.okr_id)))
for i, r in K[K.okr_id.isin(okr_ids)].reset_index().iterrows():
    o = int(r.okr_id); kid = uid('kr', o, i)
    sec, kr = clean(r.objective_section), clean(r.key_result)
    title = kr or sec or 'Key result'
    act = num(r.actual_result_pct)
    T['key_results'].append(dict(id=kid, objective_id=oid_of[o], title=title[:300], uom='%', kr_type='level', weight=num(r.kr_weight), measure='manual', baseline=0, year_target=100,
        owner_position_id=pos_of.get(clean(r.employee)), confidence='Medium', erp_kr_text=' — '.join(x for x in [sec, clean(r.expected_outcome)] if x) or None, sort=i))
    if act:
        T['check_ins'].append(dict(id=uid('ci', kid), kr_id=kid, fiscal_year=FY, quarter=1, value=act, confidence='Medium', note='Progress recorded in the ERP', sample=False))

# ---------------- annual plans (unit workbooks) ----------------
S = json.load(open(SEED))
def arr(a):
    return None if a is None else [None if v is None else round(float(v), 4) for v in a]
for code in UNITS:
    pl = S['plan'].get(code) or {}
    u = orgs[(code, ())]
    proj_of_line = {}
    if code == 'niyat-consultancy':
        # Project business: each revenue line is an engagement stream billed by milestone, not quantity x price
        for r in pl.get('rev', []):
            pid = uid('proj', code, r['id'])
            v = r.get('v') or r.get('v0') or [0] * 12
            T['projects'].append(dict(id=pid, unit_id=u, fiscal_year=FY, code=r.get('code'), name=r['name'], service_line=r['grp'], contract_value=round(sum(x or 0 for x in v), 2), phase='Planned', status='Planned', note=f"Workbook: {sum(x or 0 for x in r.get('q') or []):.2f} engagements × ETB {r.get('p') or 0:,.0f}", sort=len(T['projects'])))
            proj_of_line[r['id']] = pid
        for r in pl.get('reg', []):
            T['projects'].append(dict(id=uid('proj', code, r['id']), unit_id=u, fiscal_year=FY, name=r['name'], service_line=r.get('group'), contract_value=None, phase='Delivery', status='Active', note=(f"Duration {r.get('dur')} months" if r.get('dur') else None), sort=len(T['projects'])))
    for sec in ['rev', 'cos', 'opex', 'capex', 'proj']:
        for i, r in enumerate(pl.get(sec, [])):
            lid = uid('pl', code, r['id'])
            proj = code == 'niyat-consultancy' and sec == 'rev'
            kind = 'value' if proj else ('qty' if r.get('kind') == 'qty' else 'value')
            extra = {k: r[k] for k in ['spec', 'qty', 'unit', 'total', 'untimed', 'cost', 'start', 'end', 'desc'] if k in r}
            T['plan_lines'].append(dict(id=lid, unit_id=u, fiscal_year=FY, section=sec, line_group=r.get('grp'), code=r.get('code'), name=r['name'], uom='ETB' if proj else r.get('uom'), kind=kind,
                qty0=None if kind == 'value' else arr(r.get('q0')), qty=None if kind == 'value' else arr(r.get('q')),
                price0=None if kind == 'value' else r.get('p0'), price=None if kind == 'value' else r.get('p'),
                val0=arr(r.get('v0')), val=arr(r.get('v')), tier=r.get('tier') or 'Funded', must_pay=sec in ('cos', 'opex') and (r.get('grp') or '').startswith('Salary'),
                project_id=proj_of_line.get(r['id']), extra=extra or None, sort=i))
    for key, vals in (pl.get('gact') or {}).items():
        sec, grp = key.split('|', 1)
        for m, v in enumerate(vals):
            if v is not None:
                T['actuals'].append(dict(id=uid('act', code, key, m), unit_id=u, fiscal_year=FY, section=sec, line_group=grp, month=m + 1, value=v, source='Power BI / Finance'))
    for i, r in enumerate(pl.get('acts', [])):
        T['activity_plan_lines'].append(dict(id=uid('apl', code, r['id']), unit_id=u, fiscal_year=FY, code=r.get('id'), name=r['name'], department=r.get('dept'), uom=r.get('uom'), target_logic=r.get('obj'),
            monthly=[num(v) for v in (r.get('v0') or [])] or None, source='Annual plan workbook', sort=i))
    # cash flow
    if pl.get('open') is not None or pl.get('cfp'):
        ci = uid('cash', code, 'opening')
        T['cash_items'].append(dict(id=ci, unit_id=u, fiscal_year=FY, item='Opening cash', direction='opening', sort=0))
        T['cash_values'].append(dict(item_id=ci, month=1, plan=pl.get('open_plan'), actual=pl.get('open')))
        acts_by_item = {c['item']: c['m'] for c in pl.get('cfa', [])}
        for i, c in enumerate(pl.get('cfp', [])):
            if re.search(r'^total|net cash|opening|closing', c['item'], re.I): continue   # totals are calculated, not stored
            ci = uid('cash', code, i, c['item'])
            out = not re.search(r'collection|receipt|proceed|loan received|borrowing received|inflow|capital injection|income', c['item'], re.I)
            T['cash_items'].append(dict(id=ci, unit_id=u, fiscal_year=FY, item=c['item'], direction='out' if out else 'in', sort=i + 1))
            am = acts_by_item.get(c['item']) or [None] * 12
            for m in range(12):
                p, a = c['m'][m] if m < len(c['m']) else None, am[m] if m < len(am) else None
                if p is not None or a is not None:
                    T['cash_values'].append(dict(item_id=ci, month=m + 1, plan=p, actual=a))
    for q, f in (pl.get('pool') or {}).items():
        T['funds'].append(dict(unit_id=u, fiscal_year=FY, quarter=int(q), confirmed=f.get('confirmed') or 0, expected=f.get('expected') or 0))
    for k, rk in (pl.get('prio') or {}).items():
        T['need_priority'].append(dict(unit_id=u, fiscal_year=FY, need_key=k, rank=rk))
    T['plan_status'].append(dict(unit_id=u, fiscal_year=FY, plan_kind='annual', period='', status='Approved', note='Approved baseline loaded from the unit workbook'))

# ERP key-result weights are shares of the employee's performance (they rarely total 100 per OKR).
# In the new model weights inside an objective total 100%, so rescale them keeping their proportions;
# the same for the weights of the objectives below one parent (cascade weights).
from collections import defaultdict
def rescale(rows, key, field):
    groups = defaultdict(list)
    for r in rows:
        if r.get(key): groups[r[key]].append(r)
    for g in groups.values():
        tot = sum(r[field] or 0 for r in g)
        if tot > 0:
            for r in g: r[field] = round((r[field] or 0) * 100 / tot, 2)
        else:
            for r in g: r[field] = round(100 / len(g), 2)
rescale(T['key_results'], 'objective_id', 'weight')
rescale(T['objectives'], 'parent_objective_id', 'weight_to_parent')
json.dump(T, open(OUT, 'w'), default=str)
for k, v in T.items(): print(f'{k:22s}{len(v):6d}')
