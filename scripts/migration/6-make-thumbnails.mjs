// One-off (re-runnable): create "-sm" copies of existing product photos, and move the homepage banner to
// the fixed address site/hero.webp (+ site/hero-sm.webp) that index.html preloads.
// Dry run by default; add --apply to write.
import sharp from 'sharp';
import { supabaseAdmin, must, BUCKET } from './lib.mjs';

const APPLY = process.argv.includes('--apply');
const HERO_PATH = 'site/hero.webp';
const thumbPath = (p) => p.replace(/(\.[a-z0-9]+)$/i, '-sm$1');
const supabase = supabaseAdmin();
const storage = supabase.storage.from(BUCKET);

async function download(path) {
  const { data, error } = await storage.download(path);
  if (error) throw new Error(`download ${path}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function smallCopy(buf, maxDim, maxKB) {
  for (const q of [72, 62, 52, 45]) {
    const out = await sharp(buf).rotate().resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).webp({ quality: q }).toBuffer();
    if (out.length <= maxKB * 1024) return out;
  }
  return sharp(buf).rotate().resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 40 }).toBuffer();
}

async function put(path, body, cacheControl = '31536000') {
  await must(storage.upload(path, body, { contentType: 'image/webp', upsert: true, cacheControl }), `upload ${path}`);
}

const products = await must(supabase.from('products').select('id, name, image_paths'), 'products');
let made = 0;
for (const p of products) {
  for (const path of p.image_paths) {
    const small = await smallCopy(await download(path), 480, 45);
    console.log(`${APPLY ? '' : '[dry run] '}${p.name}: ${thumbPath(path)} (${(small.length / 1024).toFixed(1)} KB)`);
    if (APPLY) await put(thumbPath(path), small);
    made++;
  }
}

const [settings] = await must(supabase.from('store_settings').select('hero_image_path'), 'settings');
const current = settings?.hero_image_path;
if (current) {
  const buf = await download(current);
  const small = await smallCopy(buf, 640, 70);
  console.log(`${APPLY ? '' : '[dry run] '}banner: ${current} → ${HERO_PATH} (+ ${thumbPath(HERO_PATH)}, ${(small.length / 1024).toFixed(1)} KB)`);
  if (APPLY) {
    if (current !== HERO_PATH) await put(HERO_PATH, buf, '3600');
    await put(thumbPath(HERO_PATH), small, '3600');
    await must(supabase.from('store_settings').update({ hero_image_path: HERO_PATH }).eq('singleton', true), 'settings');
    if (current !== HERO_PATH) await must(storage.remove([current]), `remove ${current}`);
  }
}
console.log(`${made} product thumbnail(s)${APPLY ? ' written' : ' planned (re-run with --apply)'}.`);
