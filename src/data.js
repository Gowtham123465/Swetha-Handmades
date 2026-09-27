import { supabase, BUCKET } from './supabase';

export const STATUSES = ['Received', 'Confirmed', 'Preparing', 'Ready', 'Delivered', 'Cancelled'];
export const DEFAULT_INSTAGRAM = 'https://www.instagram.com/swetha_handmades/';
export const HERO_PATH = 'site/hero.webp';

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
    thumb: images[0] ? imageUrl(thumbPath(r.image_paths[0])) : '',
    thumbs: (r.image_paths || []).map((p) => imageUrl(thumbPath(p))),
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
    photoCount: r.order_photos?.[0]?.count || 0,
    items: [...(r.order_items || [])]
      .sort((a, b) => a.line_no - b.line_no)
      .map((i) => ({
        itemId: i.id,
        lineNo: i.line_no,
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
    settings: {
      instagram: s.instagram_url || DEFAULT_INSTAGRAM,
      heroImage: imageUrl(s.hero_image_path),
      heroSm: s.hero_image_path === HERO_PATH ? imageUrl(thumbPath(HERO_PATH)) : '',
      heroPath: s.hero_image_path || null,
    },
  };
}

// RLS returns only the customer's own orders, or all orders for a Swetha admin.
export async function loadOrders() {
  return ok(await supabase.from('orders').select('*, order_items(*), order_photos(count)').order('created_at', { ascending: false })).map(mapOrder);
}

// ── Customer photos (private bucket; uploads go through the Netlify function) ──
const PHOTO_FN = '/.netlify/functions/upload-photos';

async function photoFn(body, isJson) {
  const res = await fetch(PHOTO_FN, isJson ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

export const photoStatus = (code, mobile) => photoFn({ action: 'status', order_code: code, mobile }, true);

export function uploadPhoto(code, mobile, lineNo, blob) {
  const form = new FormData();
  form.append('order_code', code);
  form.append('mobile', mobile);
  form.append('line_no', String(lineNo));
  form.append('file', blob, 'photo');
  return photoFn(form, false);
}

export async function loadOrderPhotos(orderUuid) {
  const rows = ok(await supabase.from('order_photos').select('id, order_item_id, storage_path, created_at').eq('order_id', orderUuid).order('created_at'));
  if (!rows.length) return [];
  const bucket = supabase.storage.from('swetha-customer-uploads');
  const paths = rows.map((r) => r.storage_path);
  const [view, download] = await Promise.all([bucket.createSignedUrls(paths, 3600), bucket.createSignedUrls(paths, 3600, { download: true })]);
  ok(view);
  ok(download);
  return rows.map((r, i) => ({ ...r, url: view.data[i]?.signedUrl, downloadUrl: download.data[i]?.signedUrl }));
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

// Full size ~1200px ≤150 KB; small copies for cards/cart (≈480px) and the banner (640px).
export async function compressForUpload(file, maxDim = 1200, maxKB = 150) {
  const img = await createImageBitmap(file);
  const probe = await canvasBlob(img, 8, 'image/webp', 0.8);
  const type = probe?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  let blob;
  for (const [f, q] of [[1, 0.8], [1, 0.7], [0.92, 0.6], [0.84, 0.55], [0.75, 0.5], [0.67, 0.45]]) {
    blob = await canvasBlob(img, Math.round(maxDim * f), type, q);
    if (blob.size <= maxKB * 1024) break;
  }
  return blob;
}

export const makeThumbnail = (file) => compressForUpload(file, 480, 45);

// Small copy lives next to the full image: products/<id>/<name>.webp → products/<id>/<name>-sm.webp
export const thumbPath = (path) => path.replace(/(\.[a-z0-9]+)$/i, '-sm$1');

export async function uploadImage(path, blob, { upsert = false, cacheControl = '31536000' } = {}) {
  ok(await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl, upsert }));
  return path;
}

export async function removeImages(paths) {
  if (paths.length) ok(await supabase.storage.from(BUCKET).remove(paths));
}
const withThumbs = (paths) => paths.flatMap((p) => [p, thumbPath(p)]);

const extFor = (blob) => (blob.type === 'image/webp' ? 'webp' : 'jpg');

// images: [{ path }] for existing, [{ blob, thumb }] for new uploads, in display order.
export async function saveProduct(id, fields, images, previousPaths) {
  const productId = id || crypto.randomUUID();
  const paths = [];
  for (const img of images) {
    if (img.path) { paths.push(img.path); continue; }
    const path = await uploadImage(`products/${productId}/${crypto.randomUUID()}.${extFor(img.blob)}`, img.blob);
    if (img.thumb) await uploadImage(thumbPath(path), img.thumb);
    paths.push(path);
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
  await removeImages(withThumbs((previousPaths || []).filter((p) => !paths.includes(p))));
}

export async function deleteProduct(product) {
  ok(await supabase.from('products').delete().eq('id', product.id));
  await removeImages(withThumbs(product.imagePaths));
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

// Fixed addresses so index.html can preload the banner before the app runs. Short cache so a
// replaced banner shows within the hour.
export async function saveHeroImage(full, small, previousPath) {
  await uploadImage(HERO_PATH, full, { upsert: true, cacheControl: '3600' });
  await uploadImage(thumbPath(HERO_PATH), small, { upsert: true, cacheControl: '3600' });
  ok(await supabase.from('store_settings').update({ hero_image_path: HERO_PATH }).eq('singleton', true));
  if (previousPath && previousPath !== HERO_PATH) await removeImages(withThumbs([previousPath]));
  return HERO_PATH;
}
