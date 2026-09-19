-- ============================================================================
-- schedule_commit_status — "did my save actually land?"
-- ============================================================================
-- A lost HTTP response is not a rollback. PostgreSQL may have committed and
-- the answer never reached the browser. The client cannot tell that from a
-- request that never arrived, so it must be able to ASK rather than guess --
-- and until it has asked, it must not tell the parent that nothing changed.
--
-- Keyed by (user, idempotency_key), which is exactly what schedule_commit
-- records, so the question is "did the save carrying this key commit?" and the
-- answer is yes-with-its-counts or not-found.
--
-- Read only, and scoped to the caller: it can answer only about the caller's
-- own saves, so it cannot be used to probe for anyone else's.
create or replace function public.schedule_commit_status(p_idempotency_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); t public.schedule_transactions%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key of at least 8 characters is required'
      using errcode = '22023';
  end if;

  select * into t from public.schedule_transactions
   where user_id = v_uid and idempotency_key = p_idempotency_key;

  if not found then
    -- NOT "nothing was saved". It means no transaction carrying this key has
    -- committed. A request still in flight would also look like this, which is
    -- why the caller retries the exact payload rather than concluding anything.
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'committed',
    'transaction_id', t.id,
    'deleted',  coalesce((t.impact->>'deleted')::int, 0),
    'inserted', coalesce((t.impact->>'inserted')::int, 0),
    'updated',  coalesce((t.impact->>'updated')::int, 0),
    'impact', t.impact,
    'after_version', t.after_version,
    'committed_at', t.created_at);
end;
$$;

revoke all on function public.schedule_commit_status(text) from public, anon;
grant execute on function public.schedule_commit_status(text) to authenticated, service_role;
