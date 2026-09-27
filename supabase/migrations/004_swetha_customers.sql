-- 004_swetha_customers.sql  (guide §6.3)
-- The app upserts the customer's own row on first sign-in. No trigger on auth.users creates it.

create table if not exists swetha.customers (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text check (char_length(full_name) <= 100),
  phone        text check (char_length(phone) <= 20),
  firebase_uid text unique,            -- migration mapping (§11)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table swetha.customers enable row level security;
-- Column-level insert/update: firebase_uid is set only by the migration script (secret key).
revoke insert, update on swetha.customers from authenticated;
grant select on swetha.customers to authenticated;
grant insert (id, full_name, phone) on swetha.customers to authenticated;
grant update (full_name, phone) on swetha.customers to authenticated;

drop trigger if exists swetha_customers_updated_at on swetha.customers;
create trigger swetha_customers_updated_at
  before update on swetha.customers
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha customers: own row read" on swetha.customers;
create policy "swetha customers: own row read" on swetha.customers
  for select to authenticated
  using ((id = (select auth.uid()) and swetha.is_swetha_user()) or swetha.is_admin());

drop policy if exists "swetha customers: create own row" on swetha.customers;
create policy "swetha customers: create own row" on swetha.customers
  for insert to authenticated
  with check (id = (select auth.uid()) and swetha.is_swetha_user());

drop policy if exists "swetha customers: update own row" on swetha.customers;
create policy "swetha customers: update own row" on swetha.customers
  for update to authenticated
  using (id = (select auth.uid()) and swetha.is_swetha_user())
  with check (id = (select auth.uid()) and swetha.is_swetha_user());
