// Step 3: Firestore data → swetha.* tables, base64 images → swetha-product-images (guide §11.1, §11.3).
// Validates everything first and writes nothing if any record has a problem.
// Dry run by default. Add --apply to write. Re-runnable (upserts on firebase_id) for the final sync.
import sharp from 'sharp';
import {
  supabaseAdmin, readExport, must, toPaise, digitsOnly, blankToNull,
  BUCKET, ORDER_STATUSES, BADGES, ICONS, TONES,
} from './lib.mjs';

const APPLY = process.argv.includes('--apply');
// Final sync after admins have edited data in Supabase: only add Firebase records not imported yet.
const NEW_ONLY = process.argv.includes('--new-only');
const supabase = supabaseAdmin();
const fsData = readExport('firestore.json');
const productIdsInFirestore = new Set(fsData.products.map((p) => p._id));
if (NEW_ONLY) {
  const existing = async (table) => new Set((await must(supabase.from(table).select('firebase_id').not('firebase_id', 'is', null), `read ${table}`)).map((r) => r.firebase_id));
  const [cats, prods, ords] = await Promise.all([existing('categories'), existing('products'), existing('orders')]);
  const before = { categories: fsData.categories.length, products: fsData.products.length, orders: fsData.orders.length };
  fsData.categories = fsData.categories.filter((c) => !cats.has(c._id));
  fsData.products = fsData.products.filter((p) => !prods.has(p._id));
  fsData.orders = fsData.orders.filter((o) => !ords.has(o._id));
  fsData.settings = [];
  console.log(`--new-only: skipping already-imported records (categories ${before.categories - fsData.categories.length}, products ${before.products - fsData.products.length}, orders ${before.orders - fsData.orders.length}); store settings left as they are.`);
}

// The live site falls back to these when Firestore has no categories (src/main.jsx seedCategories).
const SEED_CATEGORIES = {
  'Gift Hampers': ['gift', 'pink'], Candles: ['candle', 'peach'], 'Photo Albums': ['camera', 'mint'],
  'Personalised Gifts': ['heart', 'lavender'], 'Home Decor': ['sparkles', 'yellow'], 'Occasion Gifts': ['gift', 'rose'],
};

const problems = [];
const warnings = [];
const key = (s) => String(s ?? '').trim().toLowerCase();

// ── Plan categories ──────────────────────────────────────
const categoryRows = fsData.categories.map((c, i) => ({
  firebase_id: c._id,
  name: String(c.name || c._id).trim(),
  icon: ICONS.includes(c.icon) ? c.icon : 'gift',
  tone: TONES.includes(c.tone) ? c.tone : 'pink',
  sort_order: i,
}));
const known = new Set(categoryRows.map((c) => key(c.name)));
const missingCategories = [];
for (const p of fsData.products) {
  const name = String(p.category ?? '').trim();
  if (name && !known.has(key(name))) {
    known.add(key(name));
    const [icon, tone] = SEED_CATEGORIES[name] || ['gift', 'pink'];
    missingCategories.push({ name, icon, tone, sort_order: categoryRows.length + missingCategories.length });
  }
}
if (missingCategories.length) warnings.push(`Categories used by products but missing in Firestore (will be created): ${missingCategories.map((c) => c.name).join(', ')}`);

// ── Plan products ────────────────────────────────────────
const productPlans = [];
for (const p of fsData.products) {
  const label = `product ${p._id} "${p.name}"`;
  const price = toPaise(p.price);
  if (!blankToNull(p.name)) problems.push(`${label}: no name`);
  if (!(price > 0)) problems.push(`${label}: invalid price ${p.price}`);
  if (!blankToNull(p.category)) problems.push(`${label}: no category`);
  if (p.badge && !BADGES.includes(p.badge)) warnings.push(`${label}: unknown badge "${p.badge}" → none`);
  const images = (Array.isArray(p.images) && p.images.length ? p.images : [p.image])
    .map((x) => (typeof x === 'string' ? x : x?.url))
    .filter(Boolean);
  if (images.length > 6) warnings.push(`${label}: ${images.length} images, keeping the first 6`);
  if (!images.length) warnings.push(`${label}: no images`);
  productPlans.push({
    fb: p,
    categoryName: String(p.category ?? '').trim(),
    images: images.slice(0, 6),
    row: {
      firebase_id: p._id,
      name: String(p.name ?? '').trim().slice(0, 120),
      price_paise: price,
      description: blankToNull(p.desc)?.slice(0, 2000) ?? null,
      badge: BADGES.includes(p.badge) ? p.badge : null,
      is_personalised: p.personalised === true,
      max_photos: p.personalised === true ? Math.min(50, Math.max(1, Number(p.maxPhotos) || 30)) : null,
      is_published: true,
    },
  });
}

// ── Plan orders ──────────────────────────────────────────
const orderPlans = [];
let droppedPhotos = 0;
for (const o of fsData.orders) {
  const code = String(o.id || o._id).trim().toUpperCase();
  const label = `order ${o._id}`;
  const status = key(o.status);
  const mobile = digitsOnly(o.mobile);
  const items = Array.isArray(o.items) ? o.items : [];

  if (!/^SH[A-Z0-9]{6}$/.test(code)) problems.push(`${label}: order code "${code}" is not SH + 6 characters`);
  if (!ORDER_STATUSES.includes(status)) problems.push(`${label}: unknown status "${o.status}"`);
  if (!/^[0-9]{10,15}$/.test(mobile)) problems.push(`${label}: mobile "${o.mobile}" is not 10–15 digits`);
  if (!blankToNull(o.name)) problems.push(`${label}: no customer name`);
  if (!blankToNull(o.address1)) problems.push(`${label}: no address line 1`);
  if (!items.length) problems.push(`${label}: no items`);
  if (!o.createdAt) warnings.push(`${label}: no createdAt, using import time`);

  const itemRows = items.map((it, i) => {
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) problems.push(`${label} item ${i + 1}: quantity ${it.qty}`);
    if (Array.isArray(it.photos) && it.photos.length) droppedPhotos += it.photos.length;
    if (it.id && !productIdsInFirestore.has(it.id)) warnings.push(`${label} item ${i + 1}: product "${it.name}" no longer exists (kept as text, no link)`);
    return {
      line_no: i + 1,
      fbProductId: it.id ?? null,
      product_name: String(it.name ?? 'Unknown item').trim(),
      unit_price_paise: toPaise(it.price),
      quantity: qty,
      custom_name: blankToNull(it.custom?.name)?.slice(0, 200) ?? null,
      custom_message: blankToNull(it.custom?.message)?.slice(0, 500) ?? null,
    };
  });

  const total = toPaise(o.total);
  const itemsSum = itemRows.reduce((s, r) => s + r.unit_price_paise * (r.quantity || 0), 0);
  if (itemsSum !== total) warnings.push(`${label}: stored total ₹${total / 100} ≠ items ₹${itemsSum / 100} (keeping the stored total)`);

  orderPlans.push({
    fbUserId: o.userId ?? null,
    items: itemRows,
    row: {
      firebase_id: o._id,
      order_code: code,
      customer_name: String(o.name ?? '').trim().slice(0, 100),
      mobile,
      email: blankToNull(o.email)?.slice(0, 254) ?? null,
      address_line1: String(o.address1 ?? '').trim().slice(0, 300),
      address_line2: blankToNull(o.address2)?.slice(0, 300) ?? null,
      landmark: blankToNull(o.landmark)?.slice(0, 200) ?? null,
      city: blankToNull(o.city)?.slice(0, 100) ?? null,
      pincode: blankToNull(o.pincode)?.slice(0, 10) ?? null,
      notes: blankToNull(o.notes)?.slice(0, 1000) ?? null,
      total_paise: total,
      amount_received_paise: Math.max(0, toPaise(o.amountReceived)),
      status,
      ...(o.createdAt ? { created_at: o.createdAt } : {}),
    },
  });
}
if (droppedPhotos) warnings.push(`${droppedPhotos} customer photo(s) attached to order items are NOT migrated (photos are handled on WhatsApp)`);

const store = fsData.settings.find((s) => s._id === 'store') || {};

// ── Report ───────────────────────────────────────────────
console.log(`categories: ${categoryRows.length} (+${missingCategories.length} missing)`);
console.log(`products:   ${productPlans.length} (${productPlans.reduce((s, p) => s + p.images.length, 0)} images)`);
console.log(`orders:     ${orderPlans.length} (${orderPlans.reduce((s, o) => s + o.items.length, 0)} items)`);
console.log(`settings:   instagram ${store.instagram ? 'yes' : 'no'}, hero image ${store.heroImage ? 'yes' : 'no'}`);
if (warnings.length) { console.log(`\nWarnings (${warnings.length}):`); warnings.forEach((w) => console.log(`  - ${w}`)); }
if (problems.length) {
  console.error(`\nPROBLEMS (${problems.length}): nothing was written. Fix these in Firestore or ask the owner:`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
if (!APPLY) { console.log('\nDry run only. Re-run with --apply to write.'); process.exit(0); }

// ── Images ───────────────────────────────────────────────
async function sourceBuffer(src) {
  if (src.startsWith('data:')) return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64');
  if (/^https:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download ${src}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`unsupported image source ${src.slice(0, 40)}…`);
}

// Guide §9: WebP, ~1200px long edge, under ~150 KB.
async function toWebp(buf) {
  for (const [edge, quality] of [[1200, 80], [1200, 70], [1200, 60], [1000, 60], [900, 50]]) {
    const out = await sharp(buf).rotate().resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (out.length <= 150 * 1024) return out;
  }
  return sharp(buf).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 45 }).toBuffer();
}

async function upload(pathInBucket, src) {
  const body = await toWebp(await sourceBuffer(src));
  await must(supabase.storage.from(BUCKET).upload(pathInBucket, body, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' }), `upload ${pathInBucket}`);
  return pathInBucket;
}

async function removeExtras(folder, keep) {
  const listed = await must(supabase.storage.from(BUCKET).list(folder, { limit: 100 }), `list ${folder}`);
  const extra = listed.map((f) => `${folder}/${f.name}`).filter((p) => !keep.includes(p));
  if (extra.length) await must(supabase.storage.from(BUCKET).remove(extra), `remove old images in ${folder}`);
}

// ── Write ────────────────────────────────────────────────
if (categoryRows.length) await must(supabase.from('categories').upsert(categoryRows, { onConflict: 'firebase_id' }), 'categories');
if (missingCategories.length) await must(supabase.from('categories').upsert(missingCategories, { onConflict: 'name' }), 'missing categories');
const categories = await must(supabase.from('categories').select('id, name'), 'read categories');
const categoryId = new Map(categories.map((c) => [key(c.name), c.id]));

const productByFb = new Map();
for (const plan of productPlans) {
  const [saved] = await must(
    supabase.from('products').upsert({ ...plan.row, category_id: categoryId.get(key(plan.categoryName)) }, { onConflict: 'firebase_id' }).select('id'),
    `product ${plan.row.firebase_id}`,
  );
  const folder = `products/${saved.id}`;
  const paths = [];
  for (let i = 0; i < plan.images.length; i++) {
    try { paths.push(await upload(`${folder}/${i + 1}.webp`, plan.images[i])); }
    catch (e) { console.warn(`  ! ${plan.row.name} image ${i + 1}: ${e.message}`); }
  }
  await removeExtras(folder, paths);
  await must(supabase.from('products').update({ image_paths: paths }).eq('id', saved.id), `product images ${plan.row.firebase_id}`);
  productByFb.set(plan.row.firebase_id, { id: saved.id, image: paths[0] ?? null });
  console.log(`  product ${plan.row.name}: ${paths.length} image(s)`);
}

// Products imported in an earlier run, so new orders still link to them.
for (const p of await must(supabase.from('products').select('id, firebase_id, image_paths').not('firebase_id', 'is', null), 'read products')) {
  if (!productByFb.has(p.firebase_id)) productByFb.set(p.firebase_id, { id: p.id, image: p.image_paths[0] ?? null });
}

const settingsUpdate = {};
if (/^https:\/\//.test(store.instagram || '')) settingsUpdate.instagram_url = store.instagram;
if (store.heroImage) {
  try { settingsUpdate.hero_image_path = await upload('site/hero.webp', store.heroImage); }
  catch (e) { console.warn(`  ! hero image: ${e.message}`); }
}
if (Object.keys(settingsUpdate).length) await must(supabase.from('store_settings').update(settingsUpdate).eq('singleton', true), 'store settings');

const customers = await must(supabase.from('customers').select('id, firebase_uid').not('firebase_uid', 'is', null), 'read customers');
const customerByFb = new Map(customers.map((c) => [c.firebase_uid, c.id]));

let linked = 0;
for (const plan of orderPlans) {
  const customerId = plan.fbUserId ? customerByFb.get(plan.fbUserId) ?? null : null;
  if (customerId) linked++;
  const [saved] = await must(
    supabase.from('orders').upsert({ ...plan.row, customer_id: customerId }, { onConflict: 'firebase_id' }).select('id'),
    `order ${plan.row.firebase_id}`,
  );
  const items = plan.items.map(({ fbProductId, ...it }) => {
    const prod = fbProductId ? productByFb.get(fbProductId) : null;
    return { ...it, order_id: saved.id, product_id: prod?.id ?? null, image_path: prod?.image ?? null };
  });
  await must(supabase.from('order_items').upsert(items, { onConflict: 'order_id,line_no' }), `items for ${plan.row.order_code}`);
  await must(supabase.from('order_items').delete().eq('order_id', saved.id).gt('line_no', items.length), `trim items ${plan.row.order_code}`);
}
console.log(`  orders: ${orderPlans.length} (${linked} linked to a customer account, ${orderPlans.length - linked} guest)`);
console.log('\nDone. Now run "npm run validate".');
