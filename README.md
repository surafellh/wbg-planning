# WBG Planning & Performance

Wagwago Business Group's planning and performance system: strategy → OKRs → annual plan (revenue, budget, resources, cash) → quarter, month and week work → organisation-first performance. It replaces the weekly tracker.

Requirements: see the "WBG Planning & Performance System — Project Requirements" doc.

## Stack
- Vite + React + TypeScript (`src/`)
- Supabase project **WBG Planning** (`wvvrntgktelzxggmhkiz`): Postgres with row-level security, email/password sign-in
- Vercel (one preview per branch)

## Run locally
```
cp .env.example .env
npm install
npm run dev
```

## Layout
- `src/lib/calc.ts` — calculation rules: fiscal calendar (FY starts 8 July, Ethiopian month starts, Saturday–Friday weeks), key-result progress, objective / organisation scores, person result `R = s·S_org + (1−s)·personal`, income statement, cash flow, resource waterline
- `src/lib/data.tsx` — loads the tables the signed-in user may see; roles and capabilities
- `src/pages/` — Home, Work, Goals, Plan (OKR plan, revenue plan — quantity × price for product units, projects and billing milestones for project units such as Niyat — budget, resources, rescope), Performance, Reports, Settings
- `supabase/migrations/` — schema, access rules, import function (applied in order)
- `scripts/build_bundle.py` — builds the pilot import file from the ERP Corporate Planning dataset, the strategy documents and the unit annual plan workbooks (the file itself is not committed)
- `scripts/smoke.cjs` — visits every page as several roles against a mocked backend

## Access
Access follows the **position**. Put a person's work email on their position (Settings → People & access); when they sign in with that email the position is linked automatically. The database enforces the same rules as the screens.
