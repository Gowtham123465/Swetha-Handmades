# Swetha Handmades: Supabase objects

Every object Swetha creates in the shared Supabase project (guide §3 MUST 11). Nothing here is in `public` or belongs to LAA India.

## Run order (SQL Editor, one file at a time)

| File | Creates | Notes |
|---|---|---|
| `000_laa_snapshot_check.sql` | nothing (read-only) | Run before 001 and after 008. Outputs must match. |
| `001_swetha_schema.sql` | schema `swetha`, grants, default privileges for `service_role` | Then add `swetha` to Data API → Exposed schemas (keep `public`). |
| `002_swetha_user_site_tag.sql` | trigger on `auth.users`, backfills `site = 'laa'` | Owner confirmed 2026-09-27: the only existing user is the LAA admin. Verify afterwards that it shows `site = 'laa'`. |
| `003_swetha_helpers.sql` | `admins`, helper functions | |
| `004_swetha_customers.sql` | `customers` | |
| `005_swetha_catalogue.sql` | `categories`, `products`, `store_settings` | |
| `006_swetha_orders.sql` | `orders`, `order_items`, Realtime on `orders` | |
| `007_swetha_order_functions.sql` | `place_order`, `track_order`, `admin_update_order` | |
| `008_swetha_storage.sql` | bucket `swetha-product-images` + 4 policies | |
| `009_swetha_storage_no_listing.sql` | replaces "public read" with "admin read" | Advisor fix: public URLs don't need a SELECT policy, and it allowed listing |
| `010_swetha_keep_personalisation.sql` | replaces `place_order` | Keeps "Name / Text" and "Special Message" for every product, not only `is_personalised` ones |
| `011_swetha_customer_photos.sql` | private bucket `swetha-customer-uploads` + 2 policies, `orders.closed_at`, `order_photos`, `admin_update_order` sets `closed_at` | Customer photo uploads (via Netlify function), 30-day retention |
| `012_swetha_products_single_select_policy.sql` | replaces the 2 product SELECT policies with 1 per role | Performance Advisor fix; same access |
| `013_swetha_place_order_server_only.sql` | `place_order(… , p_customer_id uuid)`, execute: service_role only | Spam protection: orders go through `netlify/functions/place-order.mjs` (Turnstile) |
| `014_swetha_drop_browser_place_order.sql` | drops the browser-callable `place_order(text ×9, jsonb)` | Run after the new site is live |

## LAA baseline (000, before any Swetha migration, 2026-09-27)
| k | count |
|---|---|
| tables | 11 |
| policies | 37 |
| storage policies (LAA) | 17 |
| functions | 3 |
| buckets (LAA) | 5 |

The final run of 000 must return exactly these numbers.

**2026-09-27:** 001–008 applied. `swetha` added to Exposed schemas. LAA admin tagged `site = 'laa'`. All 7 tables have RLS on. The 000 re-check was identical to the baseline.

## Migration rehearsal import (2026-09-27)
- Firebase: 2 products (8 images), 1 category, 1 order (2 items), 1 real account, 45 anonymous guest sessions (skipped).
- `swethahandmades@gmail.com` already existed (created in the Dashboard, tagged `swetha`). With the owner's approval (option A), it was linked by setting `app_metadata.firebase_uid` and reused. The admin keeps the Dashboard password; the Firebase password was not imported.
- Created "Gift Hampers" category (used by a product, missing in Firestore).
- `4-validate.mjs`: all checks passed (counts, ₹3000 total, ₹2000 received, field-by-field match, 9 images returning 200).

## Cutover (2026-09-27)
- 14:46 UTC: Firestore made read-only (`5-firebase-readonly.mjs --apply`, ruleset `c7f678c9…`). The previous live rules are saved in `scripts/migration/export/firestore-rules-before-cutover.rules` for rollback. Keep read-only until 2026-10-27, then archive and shut Firebase down.
- Final sync with `3-import-data.mjs --apply --new-only`: +1 customer, +1 order (2 items). Admin edits made in Supabase were preserved.
- 14:50 UTC: production deploy of `2afdebe` published on Netlify. The first attempt failed Netlify secret scanning because `SUPABASE_URL` was stored as a secret; it was re-saved as a normal variable.
- Netlify Visitor access: team-login protection limited to non-production deploys, so **https://swethahandmades.netlify.app is public** (owner approved). Preview deploys stay protected.
- After go-live, the 000 LAA check returned 11 / 37 / 17 / 3 / 5, **identical to the baseline**.
- Validation: counts, totals (₹6000) and images passed. "Amount received" and "SHT2VYS5 status" differ from Firebase only because of the admin's later edits in Supabase (expected).

## Schema
- `swetha`

## Tables (all RLS enabled)
| Table | anon | authenticated | Who can write |
|---|---|---|---|
| `swetha.admins` | none | select | Owner, by hand in SQL |
| `swetha.customers` | none | select; insert (id, full_name, phone); update (full_name, phone) | Customer, own row |
| `swetha.categories` | select | select, insert, update, delete | Swetha admins |
| `swetha.products` | select | select, insert, update, delete | Swetha admins |
| `swetha.store_settings` | select | select; update (instagram_url, hero_image_path) | Swetha admins |
| `swetha.orders` | none | select | Only through functions |
| `swetha.order_items` | none | select | Only through functions |
| `swetha.order_photos` | none | select (RLS: admins only) | Only the `upload-photos` Netlify function (secret key) |

## Functions
| Function | Security | Execute granted to |
|---|---|---|
| `swetha.tag_new_user_site()` (002) | definer | nobody (trigger only) |
| `swetha.is_swetha_user()` | invoker | default |
| `swetha.is_admin()` | definer | authenticated |
| `swetha.set_updated_at()` | invoker | nobody (trigger only) |
| `swetha.place_order(text ×9, jsonb, uuid)` | definer | **service_role only** (013). The old anon/authenticated version was dropped by 014 |
| `swetha.track_order(text, text)` | definer | anon, authenticated |
| `swetha.admin_update_order(uuid, text, integer)` | definer | authenticated (checks `is_admin()`) |

## Triggers
- `swetha_tag_new_user_site` on `auth.users` (002, the only Swetha object outside `swetha`/`storage`)
- `swetha_admins_updated_at`, `swetha_customers_updated_at`, `swetha_categories_updated_at`, `swetha_products_updated_at`, `swetha_store_settings_updated_at`, `swetha_orders_updated_at`, `swetha_order_items_updated_at`

## Indexes (beyond primary keys and unique constraints)
- `swetha_products_category_id_idx`, `swetha_products_is_published_idx`
- `swetha_orders_customer_created_idx`, `swetha_orders_created_at_idx`
- `swetha_order_items_product_id_idx` (`order_id` is covered by the unique `(order_id, line_no)`)

## RLS policies
- `swetha admins: admins read`
- `swetha customers: own row read` / `create own row` / `update own row`
- `swetha categories: public read` / `admins insert` / `admins update` / `admins delete`
- `swetha products: anon read published` / `signed-in read published or admin all` / `admins insert` / `admins update` / `admins delete` (012 merged the two old SELECT policies)
- `swetha store_settings: public read` / `admins update`
- `swetha orders: customer reads own`
- `swetha order_items: read with own order`

## Storage
- Bucket `swetha-product-images` (public, 1 MB per file, jpeg/png/webp)
- Bucket `swetha-customer-uploads` (**private**, 1 MB per file, jpeg/png/webp). Policies: `swetha-customer-uploads: admin read` / `admin delete`. There are no customer or anon policies; uploads go only through the function. Paths: `<order uuid>/<line_no>/<uuid>.<ext>`
- Policies on `storage.objects`: `swetha-product-images: admin read` / `admin insert` / `admin update` / `admin delete` (`public read` removed by 009; files are still served by public URL)

## Security Advisor (2026-09-27, after go-live)
- Fixed: `public_bucket_allows_listing` on `swetha-product-images` (009).
- Accepted by design (guide §6.2, §8): anon/authenticated can execute security definer `swetha.place_order`, `swetha.track_order` (guest checkout and tracking; validate all input, prices from DB, no address returned); authenticated can execute `swetha.admin_update_order` (checks `is_admin()`) and `swetha.is_admin()` (guide §6.2 verbatim).
- Reported to owner, not changed (LAA/`public`): mutable search_path on `public.register_volunteer` and `public.current_admin_role`; listing on the 4 LAA public buckets; anon/authenticated execute on `public.current_admin_role` and `public.rls_auto_enable`.
- Project-wide: leaked password protection disabled (owner decision; usually a paid-plan feature).

## Performance Advisor (2026-09-27)
- Fixed: `multiple_permissive_policies` on `swetha.products` (012).
- Reported to owner, not changed (LAA/`public`): `auth_rls_initplan` on `public.admins` ("admins: self or super_admin can read"); `multiple_permissive_policies` on `public.admins`, `events`, `faqs`, `leadership`, `membership_plans`, `programs`, `resources` (35 warnings).

## Realtime
- `supabase_realtime` publication: `swetha.orders` only

## Not yet created (later steps)
- Secret key `swetha_server` (owner, Dashboard → API Keys). The guide says `swetha-server`, but Supabase key names allow only lowercase letters, digits and underscores.
- Netlify env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- Nightly backup (§14): **running** in private repo `Gowtham123465/swetha-db-backups` at 02:00 IST (secret `SUPABASE_DB_URL`, variable `PG_MAJOR=17`). First successful run 2026-09-27 (run 36345226482): swetha, LAA public and auth dumps, kept 30 days. A test restore of the swetha dump is still to do (§14).

## Project-wide settings changed (shared with LAA)
- 2026-09-27 Auth → Redirect URLs: was empty; now `https://laaindia.org/**`, `http://localhost:5173/**`, `https://swethahandmades.netlify.app/**`, `https://*--swethahandmades.netlify.app/**` (Netlify previews).
- 2026-09-27 Auth → Site URL: `http://localhost:3000` (default) → `https://swethahandmades.netlify.app`.
- 2026-09-27 Auth → SMTP: Gmail SMTP configured by the owner; sign-up confirmation and password reset tested.

## Outside Supabase (Netlify)
- Function `netlify/functions/delete-account.mjs` (§16): deletes only `site = 'swetha'` non-admin users, using the `swetha_server` key
- Function `netlify/functions/upload-photos.mjs`: customer photo upload, authorised by order code + mobile; only items whose product `is_personalised`, up to `max_photos`, open orders only; checks the image file signature
- Function `netlify/functions/place-order.mjs`: verifies Cloudflare Turnstile (`TURNSTILE_SECRET_KEY`) and a hidden honeypot field, links signed-in Swetha customers, then calls `place_order` with the secret key
- Scheduled function `netlify/functions/purge-customer-photos.mjs` (daily): deletes photos 30 days after `orders.closed_at`, plus any photo older than 90 days
