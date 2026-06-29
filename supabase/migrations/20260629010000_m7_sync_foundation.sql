-- M7: cloud workspace + sync foundation (PLAN.md §10).
--
-- A "workspace" is the unit of sharing: it owns one shared item/meal library
-- and all of its trips. Anyone who redeems a workspace's secret link token
-- joins as a member (via anonymous auth) and may read/write that workspace's
-- records. Domain objects are stored opaquely (jsonb) with last-write-wins
-- metadata so the client's types can evolve without server migrations.

-- ---------------------------------------------------------------------------
-- Workspaces, links, membership
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My workspace',
  created_at timestamptz not null default now()
);

-- Secret link tokens. Redeeming a token grants membership; revoking it (set
-- revoked_at, or issue a fresh token) stops future joins. A workspace can hold
-- several links (e.g. an edit link and, later, a read-only link).
create table if not exists public.workspace_links (
  token uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists workspace_links_workspace on public.workspace_links(workspace_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------------------------------------------------------------------------
-- The synced data: one row per domain object. payload is the domain object as
-- jsonb (null for a tombstone). LWW columns: updated_at (set on every write)
-- and deleted_at (soft-delete tombstone so deletions propagate on pull).
-- ---------------------------------------------------------------------------

create table if not exists public.records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('trip', 'person', 'item', 'meal', 'resupply', 'planEntry')),
  id text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (workspace_id, kind, id)
);
-- The pull query is "this workspace's rows changed since a cursor".
create index if not exists records_pull on public.records(workspace_id, updated_at);

-- ---------------------------------------------------------------------------
-- Membership check. SECURITY DEFINER so policies can call it without recursing
-- through workspace_members' own RLS.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security: every table is members-only.
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_links enable row level security;
alter table public.workspace_members enable row level security;
alter table public.records enable row level security;

-- workspaces / links / members are created via the SECURITY DEFINER RPCs below,
-- so no INSERT policies for them — direct inserts are denied.
create policy workspaces_select on public.workspaces
  for select using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces
  for update using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));

create policy links_select on public.workspace_links
  for select using (public.is_workspace_member(workspace_id));
create policy links_update on public.workspace_links
  for update using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy members_select on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));

create policy records_all on public.records
  for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- RPCs. Workspace + membership creation goes through these to avoid the
-- chicken-and-egg of RLS (you can't be a member of a workspace you're creating).
-- ---------------------------------------------------------------------------

-- Create a workspace, make the caller its first editor, and mint an edit link.
create or replace function public.create_workspace(name text default 'My workspace')
returns table (workspace_id uuid, link_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
  tok uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  insert into public.workspaces (name)
    values (coalesce(nullif(name, ''), 'My workspace'))
    returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (ws, auth.uid(), 'editor');
  insert into public.workspace_links (workspace_id, role)
    values (ws, 'editor')
    returning token into tok;
  return query select ws, tok;
end;
$$;

-- Redeem a link token: add the caller as a member with the link's role.
-- Idempotent — redeeming twice is a no-op.
create or replace function public.redeem_link(link_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
  lrole text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  select workspace_id, role into ws, lrole
    from public.workspace_links
    where token = link_token and revoked_at is null;
  if ws is null then
    raise exception 'invalid or revoked link';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
    values (ws, auth.uid(), lrole)
    on conflict (workspace_id, user_id) do nothing;
  return ws;
end;
$$;

grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.redeem_link(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: stream record changes to other members of the same workspace
-- (RLS still applies to the stream). Soft-deletes arrive as UPDATEs.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.records;
