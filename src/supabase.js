import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY');

// Read before createClient, which consumes and clears the reset link's URL hash.
export const arrivedFromPasswordReset = /type=recovery/.test(window.location.hash + window.location.search);

// Publishable key only: safe in the browser because every swetha table has RLS (guide §12).
export const supabase = createClient(url, key, { db: { schema: 'swetha' } });
export const BUCKET = 'swetha-product-images';
