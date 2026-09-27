# Swetha Handmades

Single-page gift shop (React + Vite) backed by **Supabase**: Auth, Postgres (schema `swetha`), Storage. Orders are placed online; payment is arranged afterwards on WhatsApp. Hosted on Netlify.

> **Shared Supabase project.** The database also runs the live LAA India site (schema `public`). Every database change must follow *Swetha_Handmades_Shared_Supabase_Guide.md* (binding rules; ask the owner before breaking any). Never run `supabase db reset`, and never touch `public` or LAA's buckets. See [supabase/SWETHA_OBJECTS.md](supabase/SWETHA_OBJECTS.md) for everything Swetha owns.

## Environment variables

| Variable | Where | What |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` + Netlify | `https://bzwxrmltwbmglxhwywhr.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local` + Netlify | Publishable key (`sb_publishable_…`), safe in the browser because of RLS |
| `SUPABASE_URL` | Netlify only | Same URL, for the server function |
| `SUPABASE_SECRET_KEY` | Netlify only | The `swetha_server` secret key. Never in Git, frontend code or chat |

`.env.local` is git-ignored.

## Run locally

Needs Node 22.12+.

```bash
npm ci
npm run dev        # http://localhost:5173 (connects to the LIVE shared project: orders you place are real)
npm run build && npm run preview
```

The account-deletion function only runs on Netlify (or `netlify dev`).

## Deploy

Push to `main`; Netlify runs `npm run build` and publishes `dist` (see `netlify.toml`). Functions in `netlify/functions` deploy automatically.

## How it works

- **Catalogue** (`categories`, `products`, `store_settings`): anyone reads; only Swetha admins write, from `/admin`.
- **Images:** compressed in the browser to WebP (~1200 px, ≤150 KB) and stored in the `swetha-product-images` bucket. Replaced or deleted images are removed from storage.
- **Orders:** created only through `swetha.place_order`, which recomputes every price from `swetha.products`. Guests don't need to log in. Order codes look like `SH` + 6 characters.
- **Track Order:** `swetha.track_order(code, mobile)` returns only status and items (never the address), so it works on any device.
- **Admin order changes:** status and amount received go through `swetha.admin_update_order`. Orders are never deleted (tax records); admins **Cancel** instead. New orders appear live in the admin panel (Realtime on `swetha.orders`).
- **Personalisation:** "Name / Text" and "Special Message" are saved on every order item and shown in Admin → Orders → View (orders marked ✎).
- **Customer photos:** for products marked *personalised* (up to their max photos), customers upload photos on the order confirmation page or from Track Order. Guests can upload too: `netlify/functions/upload-photos.mjs` checks order ID + mobile and the photo limit, verifies the file is really an image (photos are compressed in the browser first), and stores it in the **private** `swetha-customer-uploads` bucket. Admins see and download them in Orders → View (orders marked 📷). `purge-customer-photos.mjs` runs daily and deletes photos 30 days after the order is Delivered/Cancelled (and anything older than 90 days). Swetha's privacy policy must mention this.
- **Customers:** sign up with email + password (email confirmation on). Their `swetha.customers` profile is created on first sign-in. "Delete my account" calls `netlify/functions/delete-account.mjs`, which deletes only users tagged `site = 'swetha'` who are not admins; their orders stay, unlinked.
- **Order alert emails:** EmailJS (`src/emailjs.js`). Template variables: `order_id, customer_name, customer_mobile, customer_address, order_total, order_items, to_email`.
- **WhatsApp number:** `WHATSAPP_NUMBER` at the top of `src/main.jsx`. The Instagram link is in Admin → Settings.

## Admins

Admins are added **by hand** in the Supabase SQL Editor (never through the app):

```sql
insert into swetha.admins (user_id, name) values ('<auth user uuid>', '<name>');
```

The user must be a Swetha user (`app_metadata.site = 'swetha'`). Never add the LAA admin, and never add a Swetha admin to `public.admins`. To remove access: `update swetha.admins set active = false where user_id = '…';`

## Database changes

Numbered, re-runnable SQL files in [supabase/migrations](supabase/migrations), run in order in the SQL Editor. Add new ones as `009_…sql`, following the guide: everything in schema `swetha`, RLS in the same file as the table, explicit grants, `security definer` functions with `set search_path = ''`, money in paise. Record every new object in `SWETHA_OBJECTS.md`, then re-run `000_laa_snapshot_check.sql` and compare with the baseline there.

## Backups

[supabase/backup/db-backup.yml](supabase/backup/db-backup.yml) is the nightly `pg_dump` job from the guide. It runs in the **private** repository `Gowtham123465/swetha-db-backups` (the dumps contain both organisations' data), with secret `SUPABASE_DB_URL` (Session pooler) and variable `PG_MAJOR=17`. Restore steps are in that repo's README.

## Privacy

The Privacy Policy page (footer → Privacy Policy, linked at checkout) lives in `src/main.jsx` (`Privacy`). Update it and its date whenever data handling changes (new provider, retention, payments).

## Firebase → Supabase migration and cutover

Scripts are in [scripts/migration](scripts/migration) (their own `package.json`; secrets go in its git-ignored `.env`). Each writing script is a dry run unless given `--apply`:

```bash
cd scripts/migration
npm run export                               # read-only Firebase export → ./export (personal data)
node --env-file=.env 2-import-users.mjs --apply
node --env-file=.env 3-import-data.mjs --apply
npm run validate
```

Cutover checklist:
1. Owner settings done (below) and the admin panel tested.
2. Announce a short maintenance window.
3. Make Firebase read-only: `cd firebase-legacy && npx firebase-tools deploy --only firestore:rules`
4. Final sync: `npm run export`, then `3-import-data.mjs --apply`, then `npm run validate`.
5. Set the Netlify env vars and deploy this version.
6. Re-run `supabase/migrations/000_laa_snapshot_check.sql` (must match the baseline) and Dashboard → Advisors (Security + Performance).
7. Keep Firebase read-only for 30 days, then export an archive and shut it down. Delete `scripts/migration/export/` and the Firebase service-account file 30 days after cutover.

## Owner settings (Supabase Dashboard, project-wide: follow guide §7)

- Auth → URL Configuration: **Site URL** = Swetha's live domain; **Redirect URLs** = Swetha's domain(s) **and keep** `https://laaindia.org/**`.
- Auth → SMTP: **Gmail SMTP** (`smtp.gmail.com`, port 587, the shop Gmail + a Google App Password), then raise the email rate limit. Needed for sign-up confirmation. EmailJS only sends the new-order alert and cannot send Auth emails.
- Auth → Email templates: paste [supabase/email-templates](supabase/email-templates). They branch on `{{ .Data.site }}` (branding only), so LAA admins get neutral wording.
- Do **not** enable Auth CAPTCHA, add Auth hooks, disable the Email provider or legacy keys, or rotate the JWT secret. Each breaks LAA India.
