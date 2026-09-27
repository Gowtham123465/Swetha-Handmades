import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXPORT_DIR = path.join(here, 'export');
export const BUCKET = 'swetha-product-images';

export const ORDER_STATUSES = ['received', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];
export const BADGES = ['New', 'Bestseller', 'Popular', 'Personalised', 'Handmade'];
export const ICONS = ['gift', 'camera', 'heart', 'sparkles', 'candle', 'bag'];
export const TONES = ['pink', 'peach', 'mint', 'lavender', 'yellow', 'rose'];

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}

export function supabaseAdmin() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SECRET_KEY');
  if (!url.includes('bzwxrmltwbmglxhwywhr')) {
    console.error('SUPABASE_URL is not the shared project from the guide. Stopping.');
    process.exit(1);
  }
  return createClient(url, key, {
    db: { schema: 'swetha' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function readExport(file) {
  const p = path.join(EXPORT_DIR, file);
  if (!fs.existsSync(p)) {
    console.error(`${p} not found. Run "npm run export" first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeExport(file, data) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(EXPORT_DIR, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
export const digitsOnly = (s) => String(s ?? '').replace(/[^0-9]/g, '');
export const blankToNull = (s) => {
  const t = String(s ?? '').trim();
  return t === '' ? null : t;
};

export async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// Firebase returns web-safe base64; Supabase's $fbscrypt$ parser expects standard base64.
export function stdBase64(s) {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return b;
}

export async function listAllAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await must(supabase.auth.admin.listUsers({ page, perPage: 1000 }), 'list auth users');
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}
