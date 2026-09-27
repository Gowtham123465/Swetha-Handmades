-- 010_swetha_keep_personalisation.sql
-- The product page offers "Name / Text" and "Special Message" on every product, but place_order (007)
-- kept them only for products marked is_personalised, so customers' text was silently dropped.
-- Keep it for every product (trimmed to the column limits). Everything else is unchanged from 007.

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
  p_items         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
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
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Your cart is empty or too large' using errcode = '22023';
  end if;

  -- Link the order to a customer only for a signed-in Swetha user with a profile.
  if v_uid is not null and swetha.is_swetha_user()
     and exists (select 1 from swetha.customers c where c.id = v_uid) then
    v_customer := v_uid;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := 'SH' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into swetha.orders (
        order_code, customer_id, customer_name, mobile, email,
        address_line1, address_line2, landmark, city, pincode, notes, total_paise
      ) values (
        v_code, v_customer, btrim(p_name), v_mobile, v_email,
        btrim(p_address_line1),
        nullif(btrim(coalesce(p_address_line2, '')), ''),
        nullif(btrim(coalesce(p_landmark, '')), ''),
        nullif(btrim(coalesce(p_city, '')), ''),
        nullif(btrim(coalesce(p_pincode, '')), ''),
        nullif(btrim(coalesce(p_notes, '')), ''),
        0
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
revoke execute on function swetha.place_order(text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function swetha.place_order(text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
