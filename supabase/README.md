# Supabase (cloud sync backend)

The app is local-first — IndexedDB is the source of truth. This directory holds
the **optional** cloud sync/sharing backend (M7+, see `PLAN.md §10`): a Supabase
project that stores each workspace's records so devices can share a trip.

- `config.toml` — Supabase project config.
- `migrations/` — the database schema, one timestamped `.sql` file per change,
  applied in filename order.

## Applying a migration (dashboard SQL editor)

We apply migrations by hand through the Supabase dashboard:

1. Open the project → **SQL Editor** → **New query**.
2. Paste the **entire contents** of the migration file you haven't run yet
   (`migrations/<timestamp>_<name>.sql`), oldest first.
3. Click **Run**.

Migrations are written to be **safe to re-run** (`create table if not exists`,
`create or replace function`, `drop … if exists` before `create`), so running
one twice is harmless. Apply new files in timestamp order.

> If you ever switch to the Supabase CLI with the project linked, the same files
> apply via `supabase db push` — no changes needed.

## Migrations so far

| File | What it does |
| --- | --- |
| `20260629010000_m7_sync_foundation.sql` | Workspaces, share links, membership, the `records` table (one row per synced object), RLS, and the join/create RPCs. |
| `20260629020000_allow_record_kinds.sql` | Drops the `records.kind` CHECK so the client can add new synced kinds (marks, gear, trip consumables…) without a server migration. |
| `20260723000000_server_authoritative_updated_at.sql` | Trigger stamping `records.updated_at` (and the `deleted_at` tombstone time) on every write. Makes last-write-wins use the **server** clock, so device clock drift can't revert a fresh edit. |

## Verifying a trigger/function is live

After running a migration that adds a trigger, you can confirm it exists:

```sql
select tgname
from pg_trigger
where tgrelid = 'public.records'::regclass
  and not tgisinternal;
-- expect: records_stamp_time
```

## Notes

- Timestamps are server-authoritative (the trigger above); the client adopts the
  server's `updated_at` on push, so LWW never depends on a device's wall clock.
- Existing rows keep their current `updated_at` until they're next written — the
  server-clock behavior applies to writes from the trigger onward.
