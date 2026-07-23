-- Make records.updated_at (and the deleted_at tombstone time) SERVER-authoritative
-- so last-write-wins no longer depends on client wall clocks. Device clocks
-- drift, and a fresh edit stamped with a client clock that ran behind the
-- workspace's copy would lose the comparison and get reverted on the next pull.
-- A trigger now stamps the time on every insert/update, ignoring whatever the
-- client sends, so every timestamp across all devices comes from one clock.
create or replace function public.records_stamp_time()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.deleted_at := case when new.deleted_at is not null then now() else null end;
  return new;
end;
$$;

drop trigger if exists records_stamp_time on public.records;
create trigger records_stamp_time
  before insert or update on public.records
  for each row execute function public.records_stamp_time();
