-- 000_laa_snapshot_check.sql
-- READ-ONLY. Changes nothing.
-- Run BEFORE any Swetha migration and again AFTER the last one (guide §15.1).
-- Save both outputs; they must be identical.

select 'tables' k, count(*) from information_schema.tables where table_schema = 'public'
union all select 'policies', count(*) from pg_policies where schemaname = 'public'
union all select 'storage policies (LAA)', count(*) from pg_policies
  where schemaname = 'storage' and policyname !~ '^swetha'
union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all select 'buckets (LAA)', count(*) from storage.buckets where id !~ '^swetha-';
