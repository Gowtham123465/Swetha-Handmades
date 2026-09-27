-- 008_swetha_storage.sql  (guide §9)
-- Every policy is scoped to bucket_id = 'swetha-product-images'.
-- Paths: products/<product uuid>/<file>.webp  and  site/hero-<timestamp>.webp

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('swetha-product-images', 'swetha-product-images', true, 1048576,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "swetha-product-images: public read" on storage.objects;
create policy "swetha-product-images: public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'swetha-product-images');

drop policy if exists "swetha-product-images: admin insert" on storage.objects;
create policy "swetha-product-images: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'swetha-product-images' and swetha.is_admin());

drop policy if exists "swetha-product-images: admin update" on storage.objects;
create policy "swetha-product-images: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'swetha-product-images' and swetha.is_admin())
  with check (bucket_id = 'swetha-product-images' and swetha.is_admin());

drop policy if exists "swetha-product-images: admin delete" on storage.objects;
create policy "swetha-product-images: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'swetha-product-images' and swetha.is_admin());
