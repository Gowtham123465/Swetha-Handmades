// Daily: delete customer photos 30 days after their order was Delivered or Cancelled, and any photo
// older than 90 days as a safety net for orders never closed (guide §13 shared quota, §16 retention).
// Runs only on the published production deploy. Env (Netlify): SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'swetha-customer-uploads';
const DAY = 24 * 60 * 60 * 1000;

export default async () => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    db: { schema: 'swetha' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const closedBefore = new Date(Date.now() - 30 * DAY).toISOString();
  const uploadedBefore = new Date(Date.now() - 90 * DAY).toISOString();

  const [closed, old] = await Promise.all([
    db.from('order_photos').select('id, storage_path, orders!inner(closed_at)').lt('orders.closed_at', closedBefore).limit(1000),
    db.from('order_photos').select('id, storage_path').lt('created_at', uploadedBefore).limit(1000),
  ]);
  if (closed.error || old.error) {
    console.error('purge: query failed', closed.error?.message || old.error?.message);
    return;
  }
  const byId = new Map([...closed.data, ...old.data].map((p) => [p.id, p.storage_path]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const rm = await db.storage.from(BUCKET).remove(batch.map((id) => byId.get(id)));
    if (rm.error) {
      console.error('purge: storage remove failed', rm.error.message);
      return;
    }
    const del = await db.from('order_photos').delete().in('id', batch);
    if (del.error) {
      console.error('purge: row delete failed', del.error.message);
      return;
    }
  }
  console.log(`purge: deleted ${ids.length} customer photo(s)`);
};

export const config = { schedule: '@daily' };
