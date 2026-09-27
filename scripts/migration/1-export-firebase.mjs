// Step 1: read-only export of Firestore + Firebase Auth into ./export (git-ignored).
// The export contains personal data: keep it on this machine, delete it 30 days after cutover (guide §16).
import fs from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { requireEnv, writeExport } from './lib.mjs';

const serviceAccount = JSON.parse(fs.readFileSync(requireEnv('FIREBASE_SERVICE_ACCOUNT'), 'utf8'));
if (serviceAccount.project_id !== 'swetha-handmades') {
  console.error(`Service account is for "${serviceAccount.project_id}", expected "swetha-handmades". Stopping.`);
  process.exit(1);
}
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function plain(v) {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

const collections = ['products', 'categories', 'settings', 'orders', 'users'];
const firestore = {};
for (const name of collections) {
  const snap = await db.collection(name).get();
  firestore[name] = snap.docs.map((d) => ({ _id: d.id, ...plain(d.data()) }));
  console.log(`${name}: ${snap.size} documents`);
}
writeExport('firestore.json', firestore);

const authUsers = [];
let pageToken;
do {
  const res = await getAuth().listUsers(1000, pageToken);
  for (const u of res.users) {
    authUsers.push({
      uid: u.uid,
      email: u.email ?? null,
      emailVerified: u.emailVerified,
      displayName: u.displayName ?? null,
      disabled: u.disabled,
      providers: u.providerData.map((p) => p.providerId),
      passwordHash: u.passwordHash ?? null,
      passwordSalt: u.passwordSalt ?? null,
      createdAt: u.metadata.creationTime,
    });
  }
  pageToken = res.pageToken;
} while (pageToken);
writeExport('auth-users.json', authUsers);

const anonymous = authUsers.filter((u) => !u.email && u.providers.length === 0).length;
const withHash = authUsers.filter((u) => u.passwordHash).length;
console.log(`auth users: ${authUsers.length} (${anonymous} anonymous guests, ${withHash} with a password hash)`);
console.log('Done. Files written to ./export (personal data: do not share or commit).');
