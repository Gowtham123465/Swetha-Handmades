// Customer self-service account deletion (guide §16).
// Deletes the caller's auth.users row only if it is tagged site = 'swetha' and is not a Swetha admin.
// swetha.customers cascades; swetha.orders.customer_id is set null, so order records stay (tax law) but
// are no longer linked to the person's account.
// Env (Netlify): SUPABASE_URL, SUPABASE_SECRET_KEY (the swetha_server key).
import { createClient } from '@supabase/supabase-js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Not signed in' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return json(500, { error: 'Server is not configured' });

  const admin = createClient(url, key, {
    db: { schema: 'swetha' },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json(401, { error: 'Not signed in' });

  // Never delete a user from the other site sharing this project.
  if (user.app_metadata?.site !== 'swetha') return json(403, { error: 'This account cannot be deleted here' });

  const { data: adminRow, error: adminError } = await admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (adminError) return json(500, { error: 'Could not check the account' });
  if (adminRow) return json(403, { error: 'Admin accounts must be removed by the owner' });

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('delete-account failed', user.id, deleteError.message);
    return json(500, { error: 'Could not delete the account. Please contact us.' });
  }
  return json(200, { deleted: true });
};
