import { supabase, BUCKET } from './supabase';

export const STATUSES = ['Received', 'Confirmed', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];
export const DEFAULT_INSTAGRAM = 'https://www.instagram.com/swetha_handmades/';

const rupees = (paise) => (paise || 0) / 100;
export const toPaise = (rupeesValue) => Math.round(Number(rupeesValue || 0) * 100);
const titleCase = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const imageUrl = (path) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : '');

function ok({ data, error }) {
  if (error) throw error;
  return data;
}

function mapCategory(r) {
  return { id: r.id, name: r.name, icon: r.icon, tone: r.tone };
}

function mapProduct(r, categoryById) {
  const images = (r.image_paths || []).map(imageUrl);
  return {
    id: r.id,
    name: r.name,
    categoryId: r.category_id,
    category: categoryById.get(r.category_id)?.name || '',
    price: rupees(r.price_paise),
    badge: r.badge || '',
    desc: r.description || '',
    personalised: r.is_personalised,
    maxPhotos: r.max_photos || 30,
    image: images[0] || '',
    images,
    imagePaths: r.image_paths || [],
  };
}

function mapOrder(r) {
  return {
    id: r.order_code,
    uuid: r.id,
    name: r.customer_name,
    mobile: r.mobile,
    email: r.email || '',
    address1: r.address_line1,
    address2: r.address_line2 || '',
    landmark: r.landmark || '',
    city: r.city || '',
    pincode: r.pincode || '',
    notes: r.notes || '',
    total: rupees(r.total_paise),
    amountReceived: rupees(r.amount_received_paise),
    status: titleCase(r.status),
    userId: r.customer_id,
    createdAt: r.created_at,
    items: [...(r.order_items || [])]
      .sort((a, b) => a.line_no - b.line_no)
      .map((i) => ({
        name: i.product_name,
        qty: i.quantity,
        price: rupees(i.unit_price_paise),
        image: imageUrl(i.image_path),
        custom: i.custom_name || i.custom_message ? { name: i.custom_name || '', message: i.custom_message || '' } : null,
      })),
  };
}

export async function loadCatalogue() {
  const [cats, prods, settings] = await Promise.all([
    supabase.from('categories').select('id, name, icon, tone').order('sort_order').order('name'),
    supabase.from('products').select('*').order('sort_order').order('created_at'),
    supabase.from('store_settings').select('instagram_url, hero_image_path').maybeSingle(),
  ]);
  const categories = ok(cats).map(mapCategory);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const s = ok(settings) || {};
  return {
    categories,
    products: ok(prods).map((r) => mapProduct(r, categoryById)),
    settings: { instagram: s.instagram_url || DEFAULT_INSTAGRAM, heroImage: imageUrl(s.hero_image_path), heroPath: s.hero_image_path || null },
  };
}

// RLS returns only the customer's own orders, or all orders for a Swetha admin.
export async function loadOrders() {
  return ok(await supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })).map(mapOrder);
}

export async function placeOrder(form, cart) {
  const res = ok(
    await supabase.rpc('place_order', {
      p_name: form.name,
      p_mobile: form.mobile,
      p_email: form.email,
      p_address_line1: form.address1,
      p_address_line2: form.address2,
      p_landmark: form.landmark,
      p_city: form.city,
      p_pincode: form.pincode,
      p_notes: form.notes,
      p_items: cart.map((i) => ({
        product_id: i.id,
        quantity: i.qty,
        custom_name: i.custom?.name || null,
        custom_message: i.custom?.message || null,
      })),
    }),
  );
  return { code: res.order_code, total: rupees(res.total_paise), createdAt: res.created_at };
}

export async function trackOrder(code, mobile) {
  const r = ok(await supabase.rpc('track_order', { p_order_code: code, p_mobile: mobile }));
  if (!r) return null;
  return {
    id: r.order_code,
    status: titleCase(r.status),
    createdAt: r.created_at,
    total: rupees(r.total_paise),
    items: r.items.map((i) => ({ name: i.product_name, qty: i.quantity, price: rupees(i.unit_price_paise) })),
  };
}

export async function isAdmin() {
  return ok(await supabase.rpc('is_admin')) === true;
}

// First sign-in after sign-up: create the customer's own profile row from their sign-up details.
export async function loadOrCreateProfile(user) {
  const row = ok(await supabase.from('customers').select('full_name, phone').eq('id', user.id).maybeSingle());
  if (row) return row;
  const profile = {
    full_name: user.user_metadata?.full_name?.slice(0, 100) || null,
    phone: user.user_metadata?.phone?.slice(0, 20) || null,
  };
  const { error } = await supabase.from('customers').insert({ id: user.id, ...profile });
  if (error && error.code !== '23505') throw error;
  return profile;
}

export async function sendPasswordReset(email) {
  ok(await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/' }));
}

export async function setNewPassword(password) {
  ok(await supabase.auth.updateUser({ password }));
}

export async function deleteMyAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please log in again first');
  const res = await fetch('/.netlify/functions/delete-account', {
    method: 'POST',
    headers: { authorization: `Bearer ${session.access_token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not delete the account');
  await supabase.auth.signOut({ scope: 'local' });
}

export async function adminUpdateOrder(uuid, { status, amountReceived }) {
  ok(
    await supabase.rpc('admin_update_order', {
      p_order_id: uuid,
      p_status: status ? status.toLowerCase() : null,
      p_amount_received_paise: amountReceived === undefined ? null : toPaise(amountReceived),
    }),
  );
}

// Guide §9: compress in the browser (WebP where supported, ~1200px, under ~150 KB).
function canvasBlob(img, maxDim, type, quality) {
  let { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressForUpload(file) {
  const img = await createImageBitmap(file);
  const probe = await canvasBlob(img, 8, 'image/webp', 0.8);
  const type = probe?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  let blob;
  for (const [dim, q] of [[1200, 0.8], [1200, 0.7], [1100, 0.6], [1000, 0.55], [900, 0.5], [800, 0.45]]) {
    blob = await canvasBlob(img, dim, type, q);
    if (blob.size <= 150 * 1024) break;
  }
  return blob;
}

export async function uploadImage(path, blob) {
  ok(await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
  return path;
}

export async function removeImages(paths) {
  if (paths.length) ok(await supabase.storage.from(BUCKET).remove(paths));
}

const extFor = (blob) => (blob.type === 'image/webp' ? 'webp' : 'jpg');

// images: [{ path }] for existing, [{ blob }] for new uploads, in display order.
export async function saveProduct(id, fields, images, previousPaths) {
  const productId = id || crypto.randomUUID();
  const paths = [];
  for (const img of images) {
    paths.push(img.path || (await uploadImage(`products/${productId}/${crypto.randomUUID()}.${extFor(img.blob)}`, img.blob)));
  }
  const row = {
    name: fields.name.trim(),
    category_id: fields.categoryId,
    price_paise: toPaise(fields.price),
    description: fields.desc?.trim() || null,
    badge: fields.badge || null,
    is_personalised: !!fields.personalised,
    max_photos: fields.personalised ? Math.min(50, Math.max(1, Number(fields.maxPhotos) || 30)) : null,
    image_paths: paths,
  };
  if (id) ok(await supabase.from('products').update(row).eq('id', id));
  else ok(await supabase.from('products').insert({ id: productId, ...row }));
  await removeImages((previousPaths || []).filter((p) => !paths.includes(p)));
}

export async function deleteProduct(product) {
  ok(await supabase.from('products').delete().eq('id', product.id));
  await removeImages(product.imagePaths);
}

export async function saveCategory(id, name, icon) {
  if (id) ok(await supabase.from('categories').update({ name, icon }).eq('id', id));
  else ok(await supabase.from('categories').insert({ name, icon }));
}

export async function deleteCategory(id) {
  ok(await supabase.from('categories').delete().eq('id', id));
}

export async function saveInstagram(url) {
  ok(await supabase.from('store_settings').update({ instagram_url: url }).eq('singleton', true));
}

export async function saveHeroImage(blob, previousPath) {
  const path = await uploadImage(`site/hero-${Date.now()}.${extFor(blob)}`, blob);
  ok(await supabase.from('store_settings').update({ hero_image_path: path }).eq('singleton', true));
  if (previousPath && previousPath !== path) await removeImages([previousPath]);
  return path;
}
