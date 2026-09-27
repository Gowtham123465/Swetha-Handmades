-- 001_swetha_schema.sql  (guide §5)
create schema if not exists swetha;

-- No implicit access; each table is granted explicitly in later migrations.
revoke all on schema swetha from public;
grant usage on schema swetha to anon, authenticated, service_role;

-- The server key needs full access to Swetha tables only (not public).
alter default privileges in schema swetha grant all on tables    to service_role;
alter default privileges in schema swetha grant all on sequences to service_role;
alter default privileges in schema swetha grant all on functions to service_role;
-- Do NOT add default privileges for anon or authenticated.

-- After running: Dashboard → Project Settings → Data API → Exposed schemas → add `swetha` (keep `public`).
