// Step 2: Firebase Auth users → Supabase Auth + swetha.customers (guide §11.2).
// Dry run by default. Add --apply to write.
// Re-runnable: users already imported (same firebase_uid) are reused, not duplicated.
import { supabaseAdmin, readExport, writeExport, must, stdBase64, listAllAuthUsers, blankToNull } from './lib.mjs';

const APPLY = process.argv.includes('--apply');
const supabase = supabaseAdmin();

const authUsers = readExport('auth-users.json');
const firestoreUsers = new Map(readExport('firestore.json').users.map((u) => [u._id, u]));

const hashEnv = ['FIREBASE_HASH_SIGNER_KEY', 'FIREBASE_HASH_SALT_SEPARATOR', 'FIREBASE_HASH_ROUNDS', 'FIREBASE_HASH_MEM_COST'];
const hashSet = hashEnv.filter((k) => process.env[k]);
if (hashSet.length && hashSet.length !== hashEnv.length) {
  console.error(`Set all four ${hashEnv.join(', ')} or none.`);
  process.exit(1);
}
const hashParams = hashSet.length
  ? {
      sk: stdBase64(process.env.FIREBASE_HASH_SIGNER_KEY),
      ss: stdBase64(process.env.FIREBASE_HASH_SALT_SEPARATOR),
      r: Number(process.env.FIREBASE_HASH_ROUNDS),
      n: Number(process.env.FIREBASE_HASH_MEM_COST), // exponent, e.g. 14
    }
  : null;

function fbscrypt(u) {
  if (!hashParams || !u.passwordHash || !u.passwordSalt || !u.providers.includes('password')) return undefined;
  const { n, r, ss, sk } = hashParams;
  return `$fbscrypt$v=1,n=${n},r=${r},p=1,ss=${ss},sk=${sk}$${stdBase64(u.passwordSalt)}$${stdBase64(u.passwordHash)}`;
}

const anonymous = authUsers.filter((u) => !u.email && u.providers.length === 0);
const noEmail = authUsers.filter((u) => !u.email && u.providers.length > 0);
const candidates = authUsers.filter((u) => u.email);

const existing = await listAllAuthUsers(supabase);
const byEmail = new Map(existing.map((u) => [String(u.email).toLowerCase(), u]));

// §11.2.7: stop on any email that already belongs to someone else (e.g. the LAA admin).
const collisions = candidates.filter((u) => {
  const e = byEmail.get(u.email.toLowerCase());
  return e && e.app_metadata?.firebase_uid !== u.uid;
});
if (collisions.length) {
  console.error('STOP: these emails already exist in the shared project and were not imported by this script:');
  for (const c of collisions) console.error(`  - ${c.email} (firebase uid ${c.uid})`);
  console.error('Ask the owner how to handle them. Nothing was written.');
  process.exit(1);
}

console.log(`Firebase auth users: ${authUsers.length}`);
console.log(`  to import (have email): ${candidates.length}`);
console.log(`  skipped anonymous guests: ${anonymous.length} (their orders import as guest orders)`);
if (noEmail.length) console.log(`  skipped, no email (e.g. phone-only): ${noEmail.length}`);
console.log(`  password hashes: ${hashParams ? 'will be imported' : 'NOT imported (no hash parameters in .env)'}`);
console.log(`  unverified emails: ${candidates.filter((u) => !u.emailVerified).length} (must confirm by email before signing in)`);

const admins = [];
let created = 0, reused = 0;

for (const u of candidates) {
  const profile = firestoreUsers.get(u.uid) || {};
  const fullName = blankToNull(profile.name) ?? blankToNull(u.displayName);
  const phone = blankToNull(profile.mobile);
  let id = byEmail.get(u.email.toLowerCase())?.id;

  if (!APPLY) {
    if (id) reused++; else created++;
  } else {
    if (id) {
      reused++;
    } else {
      const attrs = {
        email: u.email,
        email_confirm: u.emailVerified === true,
        app_metadata: { site: 'swetha', firebase_uid: u.uid },
        user_metadata: { full_name: fullName, site: 'swetha' },
      };
      const hash = fbscrypt(u);
      if (hash) attrs.password_hash = hash;
      if (u.disabled) attrs.ban_duration = '876000h';
      const data = await must(supabase.auth.admin.createUser(attrs), `create ${u.email}`);
      id = data.user.id;
      created++;
    }
    await must(
      supabase.from('customers').upsert(
        { id, full_name: fullName?.slice(0, 100) ?? null, phone: phone?.slice(0, 20) ?? null, firebase_uid: u.uid },
        { onConflict: 'id' },
      ),
      `customer row for ${u.email}`,
    );
  }
  if (profile.isAdmin === true) admins.push({ id, email: u.email, name: fullName || 'Swetha admin' });
}

console.log(`${APPLY ? '' : '[dry run] would have '}created ${created}, reused ${reused}.`);

if (admins.length && !APPLY) {
  console.log(`\nFirebase admins found: ${admins.length}. The SQL to add them is written after --apply.`);
}
if (admins.length && APPLY) {
  // Guide §6.2: Swetha admins are added BY HAND in the SQL Editor, never by the app or this script.
  const sql = admins
    .map((a) => `insert into swetha.admins (user_id, name) values ('${a.id}', '${a.name.replace(/'/g, "''")}') on conflict (user_id) do nothing; -- ${a.email}`)
    .join('\n');
  writeExport('admins-to-add.sql', sql);
  console.log(`\nFirebase admins found: ${admins.length}. Review export/admins-to-add.sql, then run it yourself in the SQL Editor.`);
}
if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');
