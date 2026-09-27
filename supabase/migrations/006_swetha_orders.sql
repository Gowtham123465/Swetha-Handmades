-- 006_swetha_orders.sql  (guide §5, §8, §10, §11.1, §16)
-- Customers and admins only READ orders here. Orders are created and changed
-- only through the security definer functions in 007.

create table if not exists swetha.orders (
  id                    uuid primary key default gen_random_uuid(),
  firebase_id           text unique,
  order_code            text not null unique check (order_code ~ '^SH[A-Z0-9]{6}$'),
  -- set null (not cascade) so order records survive account deletion, anonymised (§16).
  customer_id           uuid references swetha.customers(id) on delete set null,
  customer_name         text not null check (char_length(customer_name) between 1 and 100),
  mobile                text not null check (mobile ~ '^[0-9]{10,15}$'),
  email                 text check (char_length(email) <= 254),
  address_line1         text not null check (char_length(address_line1) between 1 and 300),
  address_line2         text check (char_length(address_line2) <= 300),
  landmark              text check (char_length(landmark) <= 200),
  city                  text check (char_length(city) <= 100),
  pincode               text check (char_length(pincode) <= 10),
  notes                 text check (char_length(notes) <= 1000),
  total_paise           integer not null check (total_paise >= 0),
  amount_received_paise integer not null default 0 check (amount_received_paise >= 0),
  status                text not null default 'received'
                        check (status in ('received','confirmed','preparing','ready','delivered','cancelled')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table swetha.orders enable row level security;
grant select on swetha.orders to authenticated;

create index if not exists swetha_orders_customer_created_idx on swetha.orders (customer_id, created_at desc);
create index if not exists swetha_orders_created_at_idx on swetha.orders (created_at desc);

drop trigger if exists swetha_orders_updated_at on swetha.orders;
create trigger swetha_orders_updated_at
  before update on swetha.orders
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha orders: customer reads own" on swetha.orders;
create policy "swetha orders: customer reads own" on swetha.orders
  for select to authenticated
  using ((customer_id = (select auth.uid()) and swetha.is_swetha_user()) or swetha.is_admin());

-- ── order_items: snapshot of what was bought, at the price charged ──
create table if not exists swetha.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references swetha.orders(id) on delete cascade,
  line_no          integer not null check (line_no >= 1),
  product_id       uuid references swetha.products(id) on delete set null,
  product_name     text not null,
  unit_price_paise integer not null check (unit_price_paise >= 0),
  quantity         integer not null check (quantity between 1 and 99),
  image_path       text,
  custom_name      text check (char_length(custom_name) <= 200),
  custom_message   text check (char_length(custom_message) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (order_id, line_no)
);
alter table swetha.order_items enable row level security;
grant select on swetha.order_items to authenticated;

create index if not exists swetha_order_items_product_id_idx on swetha.order_items (product_id);

drop trigger if exists swetha_order_items_updated_at on swetha.order_items;
create trigger swetha_order_items_updated_at
  before update on swetha.order_items
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha order_items: read with own order" on swetha.order_items;
create policy "swetha order_items: read with own order" on swetha.order_items
  for select to authenticated
  using (exists (
    select 1 from swetha.orders o
    where o.id = order_items.order_id
      and ((o.customer_id = (select auth.uid()) and swetha.is_swetha_user()) or swetha.is_admin())
  ));

-- ── Realtime: admin dashboard sees new orders live (orders table only, §10) ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'swetha' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table swetha.orders;
  end if;
end;
$$;
