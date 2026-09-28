-- 015_swetha_delivery_date_tracking_price_range.sql
-- 1. orders.requested_delivery_date: customer picks a date at least 15 days ahead (checked in place_order).
-- 2. orders.tracking_url: admin adds a courier tracking link (admin_update_order), shown on Track Order.
-- 3. products.price_max_paise + price_note: optional price range and "price may vary" note.
-- place_order and admin_update_order change signature, so the old versions are dropped first.
-- Safe to run while the current site is live: the new parameters are optional.

alter table swetha.orders   add column if not exists requested_delivery_date date;
alter table swetha.orders   add column if not exists tracking_url text;
alter table swetha.products add column if not exists price_max_paise integer;
alter table swetha.products add column if not exists price_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'swetha_orders_tracking_url_check') then
    alter table swetha.orders add constraint swetha_orders_tracking_url_check
      check (tracking_url is null or (tracking_url ~ '^https://' and char_length(tracking_url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'swetha_products_price_max_check') then
    alter table swetha.products add constraint swetha_products_price_max_check
      check (price_max_paise is null or price_max_paise >= price_paise);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'swetha_products_price_note_check') then
    alter table swetha.products add constraint swetha_products_price_note_check
      check (price_note is null or char_length(price_note) <= 200);
  end if;
end;
$$;

-- ── place_order: + p_delivery_date (server-only, as in 013) ──
drop function if exists swetha.place_order(text, text, text, text, text, text, text, text, text, jsonb, uuid);
create or replace function swetha.place_order(
  p_name          text,
  p_mobile        text,
  p_email         text,
  p_address_line1 text,
  p_address_line2 text,
  p_landmark      text,
  p_city          text,
  p_pincode       text,
  p_notes         text,
  p_items         jsonb,
  p_customer_id   uuid,
  p_delivery_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_mobile   text := regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g');
  v_email    text := nullif(btrim(coalesce(p_email, '')), '');
  v_item     jsonb;
  v_pid      text;
  v_qty      integer;
  v_product  record;
  v_total    bigint := 0;
  v_line     integer := 0;
  v_order_id uuid;
  v_code     text;
  v_created  timestamptz;
  v_attempt  integer := 0;
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(btrim(p_name)) > 100 then
    raise exception 'Please enter your name' using errcode = '22023';
  end if;
  if v_mobile !~ '^[0-9]{10,15}$' then
    raise exception 'Please enter a valid mobile number' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Please enter a valid email address' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_address_line1, '')), '') is null then
    raise exception 'Please enter your address' using errcode = '22023';
  end if;
  -- Customer's preferred delivery date: at least 15 days from today (Indian time), within a year.
  if p_delivery_date is not null
     and p_delivery_date < ((now() at time zone 'Asia/Kolkata')::date + 15) then
    raise exception 'Please choose a delivery date at least 15 days from today' using errcode = '22023';
  end if;
  if p_delivery_date is not null
     and p_delivery_date > ((now() at time zone 'Asia/Kolkata')::date + 365) then
    raise exception 'Please choose a delivery date within the next year' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Your cart is empty or too large' using errcode = '22023';
  end if;

  -- Link the order to a customer only for a signed-in Swetha user with a profile.
  -- The calling Netlify function has already verified the customer's session and site tag.
  if p_customer_id is not null
     and exists (select 1 from swetha.customers c where c.id = p_customer_id) then
    v_customer := p_customer_id;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := 'SH' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into swetha.orders (
        order_code, customer_id, customer_name, mobile, email,
        address_line1, address_line2, landmark, city, pincode, notes, total_paise, requested_delivery_date
      ) values (
        v_code, v_customer, btrim(p_name), v_mobile, v_email,
        btrim(p_address_line1),
        nullif(btrim(coalesce(p_address_line2, '')), ''),
        nullif(btrim(coalesce(p_landmark, '')), ''),
        nullif(btrim(coalesce(p_city, '')), ''),
        nullif(btrim(coalesce(p_pincode, '')), ''),
        nullif(btrim(coalesce(p_notes, '')), ''),
        0,
        p_delivery_date
      )
      returning id, created_at into v_order_id, v_created;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise exception 'Could not create an order number, please try again' using errcode = '40001';
      end if;
    end;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;

    v_pid := v_item ->> 'product_id';
    if v_pid is null or v_pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid product in cart' using errcode = '22023';
    end if;
    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'Invalid quantity in cart' using errcode = '22023';
    end if;
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty not between 1 and 99 then
      raise exception 'Invalid quantity in cart' using errcode = '22023';
    end if;

    select p.id, p.name, p.price_paise, p.image_paths
      into v_product
      from swetha.products p
     where p.id = v_pid::uuid and p.is_published;
    if not found then
      raise exception 'A product in your cart is no longer available' using errcode = '22023';
    end if;

    insert into swetha.order_items (
      order_id, line_no, product_id, product_name, unit_price_paise, quantity,
      image_path, custom_name, custom_message
    ) values (
      v_order_id, v_line, v_product.id, v_product.name, v_product.price_paise, v_qty,
      v_product.image_paths[1],
      left(nullif(btrim(coalesce(v_item ->> 'custom_name', '')), ''), 200),
      left(nullif(btrim(coalesce(v_item ->> 'custom_message', '')), ''), 500)
    );

    v_total := v_total + v_product.price_paise::bigint * v_qty;
  end loop;

  if v_total > 2147483647 then
    raise exception 'Order total is too large' using errcode = '22023';
  end if;

  update swetha.orders set total_paise = v_total::integer where id = v_order_id;

  return jsonb_build_object(
    'order_code',  v_code,
    'total_paise', v_total,
    'created_at',  v_created
  );
end;
$$;
revoke execute on function swetha.place_order(text, text, text, text, text, text, text, text, text, jsonb, uuid, date) from public, anon, authenticated;
grant execute on function swetha.place_order(text, text, text, text, text, text, text, text, text, jsonb, uuid, date) to service_role;

-- ── admin_update_order: + p_tracking_url ──
drop function if exists swetha.admin_update_order(uuid, text, integer);
create or replace function swetha.admin_update_order(
  p_order_id              uuid,
  p_status                text    default null,
  p_amount_received_paise integer default null,
  p_tracking_url          text    default null
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
  -- Tracking link: null = leave unchanged, '' = remove.
  if p_tracking_url is not null and btrim(p_tracking_url) <> ''
     and (btrim(p_tracking_url) !~ '^https://[^[:space:]]+$' or char_length(btrim(p_tracking_url)) > 500) then
    raise exception 'Tracking link must be a full https:// link' using errcode = '22023';
  end if;
  if p_amount_received_paise is not null and p_amount_received_paise < 0 then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;

  update swetha.orders
     set status                = coalesce(p_status, status),
         amount_received_paise = coalesce(p_amount_received_paise, amount_received_paise),
         tracking_url          = case when p_tracking_url is null then tracking_url
                                      else nullif(btrim(p_tracking_url), '') end,
         closed_at             = case when coalesce(p_status, status) in ('delivered','cancelled')
                                      then coalesce(closed_at, now()) else null end
   where id = p_order_id;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function swetha.admin_update_order(uuid, text, integer, text) from public, anon;
grant execute on function swetha.admin_update_order(uuid, text, integer, text) to authenticated;

-- ── track_order: also returns delivery date and tracking link ──
create or replace function swetha.track_order(p_order_code text, p_mobile text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_code',  o.order_code,
    'status',      o.status,
    'created_at',  o.created_at,
    'total_paise', o.total_paise,
    'requested_delivery_date', o.requested_delivery_date,
    'tracking_url', o.tracking_url,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_name',     i.product_name,
               'quantity',         i.quantity,
               'unit_price_paise', i.unit_price_paise
             ) order by i.line_no)
        from swetha.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from swetha.orders o
  where o.order_code = upper(btrim(coalesce(p_order_code, '')))
    and char_length(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g')) >= 10
    and right(o.mobile, 10) = right(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g'), 10)
$$;
revoke execute on function swetha.track_order(text, text) from public;
grant execute on function swetha.track_order(text, text) to anon, authenticated;
