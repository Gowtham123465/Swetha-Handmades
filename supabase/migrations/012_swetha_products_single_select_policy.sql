-- 012_swetha_products_single_select_policy.sql  (Performance Advisor: multiple_permissive_policies)
-- 005 had two SELECT policies for `authenticated` on swetha.products ("public read published" and
-- "admins read all"), so Postgres evaluated both on every query. Same access, one policy per role:
--   anon          → published products only
--   authenticated → published products, or all products for a Swetha admin
-- anon keeps a separate policy because it cannot execute swetha.is_admin().

drop policy if exists "swetha products: public read published" on swetha.products;
drop policy if exists "swetha products: admins read all" on swetha.products;

drop policy if exists "swetha products: anon read published" on swetha.products;
create policy "swetha products: anon read published" on swetha.products
  for select to anon using (is_published);

drop policy if exists "swetha products: signed-in read published or admin all" on swetha.products;
create policy "swetha products: signed-in read published or admin all" on swetha.products
  for select to authenticated using (is_published or swetha.is_admin());
