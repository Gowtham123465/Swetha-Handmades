// Step 4: read-only validation of the import (guide §11.3.5).
// Row counts, order totals, 20 orders compared field by field, every image URL returns 200.
import { supabaseAdmin, readExport, must, toPaise, digitsOnly, BUCKET } from './lib.mjs';

const supabase = supabaseAdmin();
const fsData = readExport('firestore.json');
const authUsers = readExport('auth-users.json');
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

async function all(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await must(supabase.from(table).select(columns).range(from, from + 999), `read ${table}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

const [categories, products, orders, items, customers, settings] = await Promise.all([
  all('categories', 'id, firebase_id, name'),
  all('products', 'id, firebase_id, name, price_paise, image_paths'),
  all('orders', 'id, firebase_id, order_code, customer_name, mobile, total_paise, amount_received_paise, status'),
  all('order_items', 'order_id, line_no, product_name, unit_price_paise, quantity'),
  all('customers', 'id, firebase_uid'),
  all('store_settings', 'hero_image_path'),
]);

// Counts
const fsItems = fsData.orders.reduce((s, o) => s + (o.items?.length || 0), 0);
check(categories.filter((c) => c.firebase_id).length === fsData.categories.length, `categories: Firestore ${fsData.categories.length}, Supabase ${categories.filter((c) => c.firebase_id).length} (+${categories.filter((c) => !c.firebase_id).length} created for missing names)`);
check(products.filter((p) => p.firebase_id).length === fsData.products.length, `products: Firestore ${fsData.products.length}, Supabase ${products.filter((p) => p.firebase_id).length}`);
check(orders.filter((o) => o.firebase_id).length === fsData.orders.length, `orders: Firestore ${fsData.orders.length}, Supabase ${orders.filter((o) => o.firebase_id).length}`);
check(items.length === fsItems, `order items: Firestore ${fsItems}, Supabase ${items.length}`);
const withEmail = authUsers.filter((u) => u.email).length;
check(customers.filter((c) => c.firebase_uid).length === withEmail, `customers: Firebase users with email ${withEmail}, Supabase ${customers.filter((c) => c.firebase_uid).length}`);

// Totals
const fsTotal = fsData.orders.reduce((s, o) => s + toPaise(o.total), 0);
const sbTotal = orders.reduce((s, o) => s + o.total_paise, 0);
check(fsTotal === sbTotal, `sum of order totals: Firestore ₹${fsTotal / 100}, Supabase ₹${sbTotal / 100}`);
const fsReceived = fsData.orders.reduce((s, o) => s + Math.max(0, toPaise(o.amountReceived)), 0);
const sbReceived = orders.reduce((s, o) => s + o.amount_received_paise, 0);
check(fsReceived === sbReceived, `sum of amount received: Firestore ₹${fsReceived / 100}, Supabase ₹${sbReceived / 100}`);

// 20 random orders, field by field
const byFb = new Map(orders.map((o) => [o.firebase_id, o]));
const itemsByOrder = Map.groupBy(items, (i) => i.order_id);
const sample = [...fsData.orders].sort(() => Math.random() - 0.5).slice(0, 20);
let sampleOk = 0;
for (const o of sample) {
  const s = byFb.get(o._id);
  const its = (s && itemsByOrder.get(s.id)) || [];
  const diffs = [];
  if (!s) diffs.push('missing');
  else {
    if (s.order_code !== String(o.id || o._id).toUpperCase()) diffs.push('order_code');
    if (s.customer_name !== String(o.name).trim().slice(0, 100)) diffs.push('name');
    if (s.mobile !== digitsOnly(o.mobile)) diffs.push('mobile');
    if (s.total_paise !== toPaise(o.total)) diffs.push('total');
    if (s.status !== String(o.status).toLowerCase()) diffs.push('status');
    if (its.length !== (o.items?.length || 0)) diffs.push('item count');
    for (const [i, it] of (o.items || []).entries()) {
      const m = its.find((x) => x.line_no === i + 1);
      if (!m || m.quantity !== Number(it.qty) || m.unit_price_paise !== toPaise(it.price)) diffs.push(`item ${i + 1}`);
    }
  }
  if (diffs.length) console.log(`      order ${o._id}: ${diffs.join(', ')}`);
  else sampleOk++;
}
check(sampleOk === sample.length, `sample of ${sample.length} orders compared field by field: ${sampleOk} match`);

// Every image URL returns 200
const paths = [...products.flatMap((p) => p.image_paths), ...settings.map((s) => s.hero_image_path).filter(Boolean)];
let bad = 0;
for (const p of paths) {
  const url = supabase.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
  const res = await fetch(url, { method: 'HEAD' });
  if (res.status !== 200) { bad++; console.log(`      ${res.status} ${p}`); }
}
check(bad === 0, `images: ${paths.length} checked, ${bad} not returning 200`);

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
