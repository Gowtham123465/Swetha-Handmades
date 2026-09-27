// Places an order after Cloudflare Turnstile confirms a real person (spam protection).
// Only this function can execute swetha.place_order (migration 013). Prices are still computed in the
// database. Env (Netlify): SUPABASE_URL, SUPABASE_SECRET_KEY, TURNSTILE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

async function turnstileOk(token, ip) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (Number(req.headers.get('content-length') || 0) > 64 * 1024) return json(413, { error: 'Request too large' });
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, TURNSTILE_SECRET_KEY: tsKey } = process.env;
  if (!url || !key || !tsKey) return json(500, { error: 'Server is not configured' });

  let input;
  try { input = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }

  // Hidden field real customers never see; bots that fill every field are rejected.
  if (input.website) return json(400, { error: 'Could not place the order. Please try again.' });

  const ip = req.headers.get('x-nf-client-connection-ip') || undefined;
  if (!(await turnstileOk(input.turnstile_token, ip))) {
    return json(403, { error: 'Please complete the "verify you are human" check and try again.' });
  }

  const db = createClient(url, key, { db: { schema: 'swetha' }, auth: { persistSession: false, autoRefreshToken: false } });

  // Link the order to a signed-in Swetha customer (the database also checks the profile exists).
  let customerId = null;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token) {
    const { data } = await db.auth.getUser(token);
    if (data?.user?.app_metadata?.site === 'swetha') customerId = data.user.id;
  }

  const f = input.form || {};
  const items = Array.isArray(input.items) ? input.items.slice(0, 50) : [];
  const { data, error } = await db.rpc('place_order', {
    p_name: text(f.name, 200),
    p_mobile: text(f.mobile, 40),
    p_email: text(f.email, 300),
    p_address_line1: text(f.address1, 400),
    p_address_line2: text(f.address2, 400),
    p_landmark: text(f.landmark, 300),
    p_city: text(f.city, 200),
    p_pincode: text(f.pincode, 20),
    p_notes: text(f.notes, 1200),
    p_items: items.map((i) => ({
      product_id: text(i?.product_id, 64),
      quantity: i?.quantity,
      custom_name: text(i?.custom_name, 300),
      custom_message: text(i?.custom_message, 600),
    })),
    p_customer_id: customerId,
  });
  if (error) {
    // 22023 = the database's own customer-facing validation messages.
    if (error.code === '22023') return json(400, { error: error.message });
    console.error('place-order failed', error.code, error.message);
    return json(500, { error: 'Could not place the order. Please try again.' });
  }
  return json(200, data);
};
