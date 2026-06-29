-- Allow the sync `records` table to hold kinds beyond the original six domain
-- tables (M7.1). Shopping/packing tick-offs (kind 'mark') are the first such
-- addition; dropping the CHECK keeps the client free to introduce new synced
-- kinds without further server migrations. RLS still scopes every row to its
-- workspace, so this doesn't widen access.
alter table public.records drop constraint if exists records_kind_check;
