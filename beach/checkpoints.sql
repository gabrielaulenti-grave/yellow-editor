-- Dedicated checkpoint table. Run against a NEW project, not a Funeral Workforce database.
-- The REST endpoint is accessed only by the Render server with a secret server-side key.
create table if not exists public.beach_checkpoints (
  id text primary key check (id = 'main'),
  version integer not null check (version = 1),
  rom_id text not null,
  training jsonb not null,
  total bigint not null check (total >= 0),
  updated_at timestamptz not null default now()
);
alter table public.beach_checkpoints enable row level security;
revoke all on public.beach_checkpoints from anon, authenticated;
grant select, insert, update on public.beach_checkpoints to service_role;

-- Refuse stale saves and cross-ROM overwrites.
create or replace function public.beach_checkpoint_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rom_id <> old.rom_id then
    raise exception 'ROM ID changed; use a different dedicated checkpoint database';
  end if;
  if new.total < old.total then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.beach_checkpoint_guard() from public, anon, authenticated;
create trigger beach_checkpoint_guard_update
before update on public.beach_checkpoints
for each row execute function public.beach_checkpoint_guard();

-- Check access after installation:
-- select relrowsecurity from pg_class where oid='public.beach_checkpoints'::regclass;
-- select count(*) from public.beach_checkpoints;
