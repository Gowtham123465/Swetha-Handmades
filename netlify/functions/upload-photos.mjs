// Customer personalisation photos (guide §9). Guests have no login, so the order code + mobile
// (same check as Track Order) authorise the upload. Files go to the PRIVATE swetha-customer-uploads bucket.
//   JSON      {action:'status', order_code, mobile}              → items that accept photos + counts
//   multipart order_code, mobile, line_no, file (one photo, ≤1 MB) → stores it
// Env (Netlify): SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'swetha-customer-uploads';
const MAX_BYTES = 1024 * 1024;
const OPEN_STATUSES = ['received', 'confirmed', 'preparing', 'ready'];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  const riff = String.fromCharCode(...bytes.slice(0, 4)), webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === 'RIFF' && webp === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

async function findOrder(db, code, mobile) {
  const orderCode = String(code || '').trim().toUpperCase();
  const digits = String(mobile || '').replace(/[^0-9]/g, '');
  if (!/^SH[A-Z0-9]{6}$/.test(orderCode) || digits.length < 10) return null;
  const { data, error } = await db
    .from('orders')
    .select('id, order_code, mobile, status, order_items(id, line_no, product_name, product_id, products(is_personalised, max_photos)), order_photos(order_item_id)')
    .eq('order_code', orderCode)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.mobile.slice(-10) !== digits.slice(-10)) return null;
  return data;
}

function photoItems(order) {
  return order.order_items
    .filter((i) => i.products?.is_personalised)
    .sort((a, b) => a.line_no - b.line_no)
    .map((i) => ({
      id: i.id,
      line_no: i.line_no,
      product_name: i.product_name,
      max_photos: i.products.max_photos || 1,
      uploaded: order.order_photos.filter((p) => p.order_item_id === i.id).length,
    }));
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (Number(req.headers.get('content-length') || 0) > MAX_BYTES + 64 * 1024) return json(413, { error: 'Photo is too large' });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return json(500, { error: 'Server is not configured' });
  const db = createClient(url, key, { db: { schema: 'swetha' }, auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const isJson = (req.headers.get('content-type') || '').includes('application/json');
    const input = isJson ? await req.json() : await req.formData();
    const get = (k) => (isJson ? input[k] : input.get(k));

    const order = await findOrder(db, get('order_code'), get('mobile'));
    if (!order) return json(404, { error: "We couldn't find that order. Please check the order ID and mobile number." });
    const items = photoItems(order);
    const open = OPEN_STATUSES.includes(order.status);

    if (isJson && get('action') === 'status') {
      return json(200, { open, items: items.map(({ id, ...rest }) => rest) });
    }
    if (isJson) return json(400, { error: 'Unknown action' });

    if (!open) return json(409, { error: 'This order is closed, so photos can no longer be added.' });
    const item = items.find((i) => i.line_no === Number(get('line_no')));
    if (!item) return json(400, { error: 'This item does not take photos.' });
    if (item.uploaded >= item.max_photos) return json(409, { error: `You've already uploaded ${item.max_photos} photo(s) for ${item.product_name}.` });

    const file = get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return json(400, { error: 'No photo received' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return json(413, { error: 'Photo is too large (max 1 MB after compression)' });
    const kind = imageType(bytes);
    if (!kind) return json(415, { error: 'Only JPG, PNG or WebP photos are accepted' });

    const path = `${order.id}/${item.line_no}/${crypto.randomUUID()}.${kind.ext}`;
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: false });
    if (up.error) throw up.error;
    const ins = await db.from('order_photos').insert({ order_id: order.id, order_item_id: item.id, storage_path: path, size_bytes: bytes.length });
    if (ins.error) {
      await db.storage.from(BUCKET).remove([path]);
      throw ins.error;
    }
    return json(200, { uploaded: item.uploaded + 1, max_photos: item.max_photos });
  } catch (e) {
    console.error('upload-photos failed', e?.message || e);
    return json(500, { error: 'Upload failed. Please try again.' });
  }
};
