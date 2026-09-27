-- 003_swetha_helpers.sql  (guide §6.2)
-- Order matters: table → function (reads the table) → policy (calls the function).

create or replace function swetha.is_swetha_user()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'site') = 'swetha', false)
$$;

create or replace function swetha.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function swetha.set_updated_at() from public, anon, authenticated;

create table if not exists swetha.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table swetha.admins enable row level security;
grant select on swetha.admins to authenticated;

drop trigger if exists swetha_admins_updated_at on swetha.admins;
create trigger swetha_admins_updated_at
  before update on swetha.admins
  for each row execute function swetha.set_updated_at();

create or replace function swetha.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from swetha.admins a
    where a.user_id = (select auth.uid()) and a.active
  ) and coalesce((auth.jwt() -> 'app_metadata' ->> 'site') = 'swetha', false)
$$;
revoke execute on function swetha.is_admin() from public, anon;
grant execute on function swetha.is_admin() to authenticated;

drop policy if exists "swetha admins: admins read" on swetha.admins;
create policy "swetha admins: admins read" on swetha.admins
  for select to authenticated using (swetha.is_admin());

-- Swetha admins are added BY HAND, never through the app:
--   insert into swetha.admins (user_id, name) values ('<auth user uuid>', '<name>');
-- Never add the LAA admin here, and never add a Swetha admin to public.admins.
