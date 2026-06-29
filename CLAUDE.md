# Hiking Trip Meal Planner

Local-first React SPA for planning food on multi-day hikes. See PLAN.md for
the full design, data model, and milestone history (M0–M6, all shipped).

## Commands

```bash
npm run dev        # dev server
npm test           # Vitest unit tests
npm run typecheck  # tsc (covers src/ and tests/)
npm run lint       # eslint
npm run build      # production build
npm run e2e        # Playwright smoke test (needs `npx playwright install chromium`)
```

## Architecture rules

- `src/domain/` is pure: no imports from `src/store/` or `src/ui/`, no
  browser APIs. All derived values (densities, meal roll-ups, carries,
  totals, generated plans) are computed here, never stored.
- `src/store/` owns Dexie (IndexedDB). Schema changes bump `db.version()`
  in `db.ts`. Writes with integrity rules (delete-blocking, cascades) go
  through `repos.ts`, not raw table access.
- Networked code lives only in `src/extract/` and `src/sync/`; both load their
  SDK dynamically to keep the main bundle lean. `src/extract/` is photo/URL →
  item via the Anthropic API (user-supplied key). `src/sync/` is the optional
  cloud sync/sharing layer over Supabase (M7+, PLAN.md §10) — IndexedDB stays
  the local source of truth; it only pushes/pulls `SyncRecord`s (LWW resolver
  in `src/domain/sync.ts`). The Anthropic key stays in localStorage — never
  Dexie, a JSON backup, or a synced workspace.
- Every acceptance criterion from the user stories maps to a unit test in
  `tests/` (mirrors `src/`). The story 3.2 carry example is the canonical
  carries fixture.

## Workflow

- **Commit intermittently**: small, focused commits as work progresses
  (e.g. domain logic, store layer, UI, tests separately) — not one big
  commit per feature.
- Branch per change → PR to `main` → merge when CI
  (`.github/workflows/ci.yml`) is green.
