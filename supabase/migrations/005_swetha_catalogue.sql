-- 005_swetha_catalogue.sql  (guide §5, §8, §11.1)
-- Public catalogue: anyone reads; only Swetha admins write (admins edit from the browser).

-- ── categories ─────────────────────────────────────────────
create table if not exists swetha.categories (
  id          uuid primary key default gen_random_uuid(),
  firebase_id text unique,
  name        text not null unique check (char_length(name) between 1 and 60),
  icon        text not null default 'gift' check (icon in ('gift','camera','heart','sparkles','candle','bag')),
  tone        text not null default 'pink' check (tone in ('pink','peach','mint','lavender','yellow','rose')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table swetha.categories enable row level security;
grant select on swetha.categories to anon;
grant select, insert, update, delete on swetha.categories to authenticated;

drop trigger if exists swetha_categories_updated_at on swetha.categories;
create trigger swetha_categories_updated_at
  before update on swetha.categories
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha categories: public read" on swetha.categories;
create policy "swetha categories: public read" on swetha.categories
  for select to anon, authenticated using (true);
drop policy if exists "swetha categories: admins insert" on swetha.categories;
create policy "swetha categories: admins insert" on swetha.categories
  for insert to authenticated with check (swetha.is_admin());
drop policy if exists "swetha categories: admins update" on swetha.categories;
create policy "swetha categories: admins update" on swetha.categories
  for update to authenticated using (swetha.is_admin()) with check (swetha.is_admin());
drop policy if exists "swetha categories: admins delete" on swetha.categories;
create policy "swetha categories: admins delete" on swetha.categories
  for delete to authenticated using (swetha.is_admin());

-- ── products ───────────────────────────────────────────────
create table if not exists swetha.products (
  id              uuid primary key default gen_random_uuid(),
  firebase_id     text unique,
  name            text not null check (char_length(name) between 1 and 120),
  category_id     uuid not null references swetha.categories(id) on delete restrict,
  price_paise     integer not null check (price_paise > 0),
  description     text check (char_length(description) <= 2000),
  badge           text check (badge in ('New','Bestseller','Popular','Personalised','Handmade')),
  is_personalised boolean not null default false,
  max_photos      integer check (max_photos between 1 and 50),
  image_paths     text[] not null default '{}' check (cardinality(image_paths) <= 6),
  is_published    boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table swetha.products enable row level security;
grant select on swetha.products to anon;
grant select, insert, update, delete on swetha.products to authenticated;

create index if not exists swetha_products_category_id_idx on swetha.products (category_id);
create index if not exists swetha_products_is_published_idx on swetha.products (is_published);

drop trigger if exists swetha_products_updated_at on swetha.products;
create trigger swetha_products_updated_at
  before update on swetha.products
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha products: public read published" on swetha.products;
create policy "swetha products: public read published" on swetha.products
  for select to anon, authenticated using (is_published);
drop policy if exists "swetha products: admins read all" on swetha.products;
create policy "swetha products: admins read all" on swetha.products
  for select to authenticated using (swetha.is_admin());
drop policy if exists "swetha products: admins insert" on swetha.products;
create policy "swetha products: admins insert" on swetha.products
  for insert to authenticated with check (swetha.is_admin());
drop policy if exists "swetha products: admins update" on swetha.products;
create policy "swetha products: admins update" on swetha.products
  for update to authenticated using (swetha.is_admin()) with check (swetha.is_admin());
drop policy if exists "swetha products: admins delete" on swetha.products;
create policy "swetha products: admins delete" on swetha.products
  for delete to authenticated using (swetha.is_admin());

-- ── store_settings (single row) ────────────────────────────
create table if not exists swetha.store_settings (
  id              uuid primary key default gen_random_uuid(),
  singleton       boolean not null default true unique check (singleton),
  instagram_url   text check (instagram_url ~ '^https://'),
  hero_image_path text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table swetha.store_settings enable row level security;
grant select on swetha.store_settings to anon;
grant select on swetha.store_settings to authenticated;
grant update (instagram_url, hero_image_path) on swetha.store_settings to authenticated;

drop trigger if exists swetha_store_settings_updated_at on swetha.store_settings;
create trigger swetha_store_settings_updated_at
  before update on swetha.store_settings
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha store_settings: public read" on swetha.store_settings;
create policy "swetha store_settings: public read" on swetha.store_settings
  for select to anon, authenticated using (true);
drop policy if exists "swetha store_settings: admins update" on swetha.store_settings;
create policy "swetha store_settings: admins update" on swetha.store_settings
  for update to authenticated using (swetha.is_admin()) with check (swetha.is_admin());

insert into swetha.store_settings (instagram_url)
values ('https://www.instagram.com/swetha_handmades/')
on conflict (singleton) do nothing;
