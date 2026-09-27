-- 009_swetha_storage_no_listing.sql  (Security Advisor: public_bucket_allows_listing)
-- A public bucket serves files by URL without any SELECT policy, so the broad "public read" policy only
-- let anyone LIST every file. Replace it with admin-only read (the admin panel needs SELECT to delete
-- or replace images). Public image URLs keep working.

drop policy if exists "swetha-product-images: public read" on storage.objects;

drop policy if exists "swetha-product-images: admin read" on storage.objects;
create policy "swetha-product-images: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'swetha-product-images' and swetha.is_admin());
