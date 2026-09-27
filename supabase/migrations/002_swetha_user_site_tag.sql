-- 002_swetha_user_site_tag.sql  (guide §6.1, verbatim)
-- Pre-check done 2026-09-27: auth.users has one row, the LAA admin, and it is in public.admins.

create or replace function swetha.tag_new_user_site()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Keep a tag set server-side (admin API / SQL); otherwise it's a Swetha sign-up.
  if coalesce(new.raw_app_meta_data ->> 'site', '') = '' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('site', 'swetha');
  end if;
  return new;
end;
$$;
revoke execute on function swetha.tag_new_user_site() from public, anon, authenticated;

drop trigger if exists swetha_tag_new_user_site on auth.users;
create trigger swetha_tag_new_user_site
  before insert on auth.users
  for each row execute function swetha.tag_new_user_site();

-- One-time backfill: every user that exists today is an LAA admin.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"site":"laa"}'::jsonb
where id in (select id from public.admins);

-- Verify afterwards (must show 'laa'):
--   select id, raw_app_meta_data ->> 'site' as site from auth.users;
