-- rooted-staging ONLY (cvgqovweybggrqakhdtd). NOT production.
--
-- Supabase's documented remedy for "500: Database error querying schema":
--   https://supabase.com/docs/guides/troubleshooting/
--     auth-error-500-database-error-querying-schema-eb6b44
--
-- "the Supabase Auth server has encountered NULL values in the auth.users
--  table where a valid string or empty string is expected ... usually occurs
--  following manual SQL inserts or updates to the auth.users table."
--
-- rooted-staging's 6 synthetic accounts were created by hand, so all 6 carry
-- NULL in four columns GoTrue requires to be ''. Production carries '' in all
-- four for all 2,552 users and zero NULLs, which is the shape being restored.
--
-- This is a DATA fix on 6 synthetic .test accounts. It alters no schema, adds
-- no column, changes no constraint, and touches no real family.

begin;

-- Refuse to run anywhere but rooted-staging.
do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'unexpected server version';
  end if;
  if (select count(*) from auth.users) > 50 then
    raise exception 'auth.users has % rows; this is not the synthetic staging project',
      (select count(*) from auth.users);
  end if;
  if exists (select 1 from auth.users where email not like '%@rooted-staging.test'
                                        and email not like '%@example.invalid') then
    raise exception 'auth.users contains a non-synthetic address; refusing to touch it';
  end if;
end $$;

update auth.users set confirmation_token     = '' where confirmation_token     is null;
update auth.users set recovery_token         = '' where recovery_token         is null;
update auth.users set email_change           = '' where email_change           is null;
update auth.users set email_change_token_new = '' where email_change_token_new is null;

-- Prove the shape now matches production before committing.
do $$
declare bad int;
begin
  select count(*) into bad from auth.users
   where confirmation_token is null or recovery_token is null
      or email_change is null or email_change_token_new is null;
  if bad > 0 then raise exception 'still % row(s) with NULL token columns', bad; end if;
end $$;

commit;
