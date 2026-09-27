-- 011_swetha_customer_photos.sql  (guide §5, §8, §9, §13, §16)
-- Customers upload personalisation photos for an order. Uploads go ONLY through the Netlify function
-- netlify/functions/upload-photos.mjs (secret key, checks order code + mobile, photo limits), so there are
-- no customer/anon storage policies. Swetha admins can view and delete. Photos are personal data and use the
-- shared 1 GB quota, so netlify/functions/purge-customer-photos.mjs deletes them 30 days after the order is
-- Delivered or Cancelled (safety net: 90 days after upload).

-- ── Private bucket ─────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('swetha-customer-uploads', 'swetha-customer-uploads', false, 1048576,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "swetha-customer-uploads: admin read" on storage.objects;
create policy "swetha-customer-uploads: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'swetha-customer-uploads' and swetha.is_admin());

drop policy if exists "swetha-customer-uploads: admin delete" on storage.objects;
create policy "swetha-customer-uploads: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'swetha-customer-uploads' and swetha.is_admin());

-- ── When an order was closed (delivered/cancelled), for the 30-day retention ──
alter table swetha.orders add column if not exists closed_at timestamptz;
update swetha.orders set closed_at = updated_at
 where status in ('delivered','cancelled') and closed_at is null;
create index if not exists swetha_orders_closed_at_idx on swetha.orders (closed_at) where closed_at is not null;

-- ── order_photos: one row per uploaded file ────────────────
create table if not exists swetha.order_photos (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references swetha.orders(id) on delete cascade,
  order_item_id uuid not null references swetha.order_items(id) on delete cascade,
  storage_path  text not null unique,
  size_bytes    integer not null check (size_bytes between 1 and 1048576),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table swetha.order_photos enable row level security;
grant select on swetha.order_photos to authenticated;

create index if not exists swetha_order_photos_order_id_idx on swetha.order_photos (order_id);
create index if not exists swetha_order_photos_order_item_id_idx on swetha.order_photos (order_item_id);
create index if not exists swetha_order_photos_created_at_idx on swetha.order_photos (created_at);

drop trigger if exists swetha_order_photos_updated_at on swetha.order_photos;
create trigger swetha_order_photos_updated_at
  before update on swetha.order_photos
  for each row execute function swetha.set_updated_at();

drop policy if exists "swetha order_photos: admins read" on swetha.order_photos;
create policy "swetha order_photos: admins read" on swetha.order_photos
  for select to authenticated using (swetha.is_admin());

-- ── admin_update_order: also record closed_at ─────────────
create or replace function swetha.admin_update_order(
  p_order_id              uuid,
  p_status                text    default null,
  p_amount_received_paise integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not swetha.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status is not null
     and p_status not in ('received','confirmed','preparing','ready','delivered','cancelled') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if p_amount_received_paise is not null and p_amount_received_paise < 0 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;

  update swetha.orders
     set status                = coalesce(p_status, status),
         amount_received_paise = coalesce(p_amount_received_paise, amount_received_paise),
         closed_at             = case when coalesce(p_status, status) in ('delivered','cancelled')
                                      then coalesce(closed_at, now()) else null end
   where id = p_order_id;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function swetha.admin_update_order(uuid, text, integer) from public, anon;
grant execute on function swetha.admin_update_order(uuid, text, integer) to authenticated;
