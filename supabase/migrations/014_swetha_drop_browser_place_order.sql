-- 014_swetha_drop_browser_place_order.sql  (spam protection, step 2 of 2)
-- Run ONLY after the website that places orders through netlify/functions/place-order.mjs is live.
-- Removes the old browser-callable place_order, so orders can no longer skip the Turnstile check.

drop function if exists swetha.place_order(text, text, text, text, text, text, text, text, text, jsonb);
