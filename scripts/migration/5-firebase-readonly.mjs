// Cutover step: make Firestore read-only for the 30-day rollback window (guide §11.4).
// Saves the currently live rules to export/ first, so they can be restored for a rollback.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { requireEnv, writeExport } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(fs.readFileSync(requireEnv('FIREBASE_SERVICE_ACCOUNT'), 'utf8'));
if (serviceAccount.project_id !== 'swetha-handmades') {
  console.error(`Service account is for "${serviceAccount.project_id}", expected "swetha-handmades". Stopping.`);
  process.exit(1);
}
initializeApp({ credential: cert(serviceAccount) });
const rules = getSecurityRules();

const current = await rules.getFirestoreRuleset();
writeExport('firestore-rules-before-cutover.rules', current.source[0].content);
console.log(`Saved live rules (ruleset ${current.name}, created ${current.createTime}) to export/firestore-rules-before-cutover.rules`);

const source = fs.readFileSync(path.join(here, '../../firebase-legacy/firestore.readonly.rules'), 'utf8');
if (!/allow write: if false/.test(source)) {
  console.error('firestore.readonly.rules does not look read-only. Stopping.');
  process.exit(1);
}
if (!process.argv.includes('--apply')) {
  console.log('Dry run. Re-run with --apply to release the read-only rules.');
  process.exit(0);
}
const released = await rules.releaseFirestoreRulesetFromSource(source);
console.log(`Firestore is now READ-ONLY (ruleset ${released.name}, released ${released.createTime}).`);
