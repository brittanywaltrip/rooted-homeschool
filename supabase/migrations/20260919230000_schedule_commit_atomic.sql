-- ============================================================================
-- schedule_commit — the atomic save, and the removal of the client's DELETE.
-- ============================================================================
-- WHAT THIS CLOSES
--
-- The Schedule Builder saved by issuing a PostgREST DELETE and then separate
-- INSERTs. Those are different transactions. If the second never lands -- a
-- closed tab, a dropped connection, a failed assertion -- the delete has
-- already committed and the lessons are gone. That is how one family lost 99
-- completed lessons in August 2026.
--
-- AUTHORIZATION, NOT SHAPE
--
-- An earlier draft guarded "multi-row deletes" and gated them on a
-- transaction-local GUC. Both were wrong:
--
--   * Row count is not the property that matters. A builder save that replaces
--     ONE row is the same unfinished DELETE/INSERT pair as one that replaces
--     180. A multi-row rule leaves the single-row replacement wide open.
--   * set_config() is executable by PUBLIC. A marker a caller can set is not
--     authorization, it is a request.
--
-- So authorization comes from the GRANT. `authenticated` and `anon` lose DELETE
-- on public.lessons entirely. Deleting becomes something only a SECURITY
-- DEFINER function can do, and each such function re-establishes ownership
-- itself, because SECURITY DEFINER bypasses RLS. There is no marker to forge
-- and no shape to imitate.
--
-- STALE CLIENTS
--
-- An already-loaded bundle cannot be patched, so it must fail CLOSED. Its
-- direct DELETE now raises 42501 before touching a row. The save fails and
-- nothing is destroyed. See the migration's companion notes for exactly what
-- each old path does; do not assume every one of them recovers on reload.
-- ============================================================================

-- SEARCH_PATH: every function here sets `public, pg_temp`. Naming pg_temp
-- LAST is the point: when it is not listed, the temporary schema is searched
-- FIRST for relation names, so a caller who can create a temp table can shadow
-- a table a SECURITY DEFINER body refers to. The repo's own trigger functions
-- already use this form; several older schedule_* functions set only
-- `public` and should be brought into line separately.

-- ── 1. The deliberate single-lesson delete keeps working, via a function ────
-- Today and Plan let a parent delete one lesson. That is legitimate and must
-- survive the revoke, so it gets its own narrow entry point. It deletes
-- exactly one row, by id, after proving the caller owns it.
create or replace function public.delete_lesson(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_owner uuid; v_cascade int;
begin
  if p_lesson_id is null then
    raise exception 'delete_lesson requires a lesson id' using errcode = '22023';
  end if;

  -- Ownership is re-established here. RLS does not protect a SECURITY DEFINER
  -- body, so the policy that would have covered this must be restated.
  select l.user_id into v_owner from public.lessons l where l.id = p_lesson_id;
  if v_owner is null then
    -- Absent and not-yours are the same answer, so this cannot be used to
    -- probe for the existence of another family's rows.
    raise exception 'lesson not found' using errcode = '42501';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'lesson not found' using errcode = '42501';
  end if;

  -- CASCADE. lessons.continues_lesson_id references lessons ON DELETE CASCADE,
  -- so removing one row silently removes anything continuing from it. A parent
  -- deleting a single lesson is not asking for that.
  select count(*) into v_cascade from public.lessons
   where continues_lesson_id = p_lesson_id and id <> p_lesson_id;
  if v_cascade > 0 then
    raise exception
      '% lesson(s) continue from this one and would be deleted with it', v_cascade
      using errcode = '40001';
  end if;

  delete from public.lessons where id = p_lesson_id;
end;
$$;

revoke all on function public.delete_lesson(uuid) from public, anon;
grant execute on function public.delete_lesson(uuid) to authenticated, service_role;

-- ── 2. The atomic save ─────────────────────────────────────────────────────
-- EVERYTHING the save does happens here, in one transaction: goal field
-- updates, pin releases, the floor-scoped delete, the inserts, and the
-- pointer. A save that is atomic in its DELETE/INSERT pair but leaves the goal
-- row or the pointer to a separate request is still a partial save.
create or replace function public.schedule_commit(
  p_proposal_id     uuid,
  p_goal_updates    jsonb,   -- {goal_id: {field: value, ...}, ...}
  p_release_pins    uuid[],  -- lessons whose queue_pinned is cleared
  p_delete_ids      uuid[],  -- EXACT ids to delete; never a predicate
  p_insert_rows     jsonb,   -- array of full lesson rows
  p_pointers        jsonb,   -- {goal_id: current_lesson}
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_prop       public.schedule_proposals%rowtype;
  v_now_ver    text;
  v_txn_id     uuid;
  v_existing   public.schedule_transactions%rowtype;
  v_before     jsonb;
  v_deleted    int := 0;
  v_inserted   int := 0;
  v_goal       uuid;
  v_bad        int;
  v_digest     text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key of at least 8 characters is required'
      using errcode = '22023';
  end if;

  -- ── RETRY AFTER AN UNCERTAIN RESPONSE ───────────────────────────────────
  -- The client cannot tell a lost response from a lost request. If this key
  -- already committed, return that result rather than doing the work twice.
  -- The digest binds the key to THIS request. Returning the old result for a
  -- DIFFERENT payload under a reused key would silently discard the new work
  -- and report success for something that never happened.
  v_digest := encode(sha256(convert_to(
      coalesce(p_proposal_id::text,'') || '|' ||
      coalesce(p_goal_updates::text,'') || '|' ||
      coalesce(array_to_string(p_release_pins, ','),'') || '|' ||
      coalesce(array_to_string(p_delete_ids, ','),'') || '|' ||
      coalesce(p_insert_rows::text,'') || '|' ||
      coalesce(p_pointers::text,''), 'UTF8')), 'hex');

  select * into v_existing from public.schedule_transactions
   where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if coalesce(v_existing.impact->>'request_digest','') is distinct from v_digest then
      raise exception
        'idempotency key % was already used for a different request. A key identifies one request; use a new key.', p_idempotency_key
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'status', 'already_committed',
      'transaction_id', v_existing.id,
      'impact', v_existing.impact,
      'after_version', v_existing.after_version);
  end if;
  -- A key is per user: the unique index is (user_id, idempotency_key), so the
  -- same key from another account is a different row and cannot collide.

  -- ── THE PROPOSAL ────────────────────────────────────────────────────────
  -- Locked, so two concurrent saves cannot both consume it.
  select * into v_prop from public.schedule_proposals
   where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal not found' using errcode = '42501';
  end if;
  if v_prop.user_id is distinct from v_uid then
    raise exception 'proposal not found' using errcode = '42501';
  end if;
  if v_prop.consumed_at is not null then
    raise exception 'proposal % was already consumed', p_proposal_id using errcode = '40001';
  end if;
  if v_prop.expires_at <= now() then
    raise exception 'proposal % expired at %', p_proposal_id, v_prop.expires_at using errcode = '40001';
  end if;

  -- ── CONCURRENCY ─────────────────────────────────────────────────────────
  -- Lock the goals in a deterministic order before reading state, so two saves
  -- on the same goals serialise instead of interleaving.
  perform 1 from public.curriculum_goals
    where id = any(v_prop.goal_ids) order by id for update;

  -- ── OWNERSHIP OF EVERY TOUCHED OBJECT, INSIDE THE TRANSACTION ───────────
  -- Re-established here, not inherited from whatever computed the proposal.
  select count(*) into v_bad from public.curriculum_goals
   where id = any(v_prop.goal_ids) and user_id is distinct from v_uid;
  if v_bad > 0 then
    raise exception 'proposal names % goal(s) that are not yours', v_bad using errcode = '42501';
  end if;
  select count(*) into v_bad from public.curriculum_goals
   where id = any(v_prop.goal_ids);
  if v_bad <> coalesce(array_length(v_prop.goal_ids, 1), 0) then
    raise exception 'a goal named by the proposal no longer exists' using errcode = '40001';
  end if;

  -- Every id handed in must belong to the caller AND to a goal in the
  -- proposal. Without the second test a caller could delete their own rows
  -- from a goal the proposal never mentioned and never locked.
  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
    select count(*) into v_bad from public.lessons
     where id = any(p_delete_ids)
       and (user_id is distinct from v_uid
            or curriculum_goal_id is null
            or not (curriculum_goal_id = any(v_prop.goal_ids)));
    if v_bad > 0 then
      raise exception '% delete id(s) are not yours or lie outside the proposal''s goals', v_bad
        using errcode = '42501';
    end if;
  end if;
  if p_release_pins is not null and array_length(p_release_pins, 1) > 0 then
    select count(*) into v_bad from public.lessons
     where id = any(p_release_pins)
       and (user_id is distinct from v_uid
            or curriculum_goal_id is null
            or not (curriculum_goal_id = any(v_prop.goal_ids)));
    if v_bad > 0 then
      raise exception '% pin id(s) are outside the proposal''s goals', v_bad using errcode = '42501';
    end if;
  end if;

  -- ── V2: WHAT THE DELETE MAY NOT TOUCH, RE-DERIVED HERE ──────────────────
  -- The builder decides what to hold back (surviving pins, skipped rows, and
  -- rows carrying the parent's notes or minutes) from a read it took BEFORE
  -- the proposal. The state version does not hash notes, minutes_spent or
  -- title, so a row that gains any of them between that read and this commit
  -- is neither held back nor detected as drift -- and delete-then-reinsert
  -- would destroy the parent's words.
  --
  -- So the rule is re-evaluated against the rows as they are NOW, under the
  -- locks taken above. The client's list is a request; this is the check.
  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
    select count(*) into v_bad from public.lessons
     where id = any(p_delete_ids)
       and (completed
            or queue_pinned
            or skipped
            or (notes is not null and btrim(notes) <> '')
            or minutes_spent is not null);
    if v_bad > 0 then
      raise exception
        '% row(s) in this save now carry work that must not be deleted (completed, pinned, skipped, or holding notes or minutes). Rebuild the proposal.', v_bad
        using errcode = '40001';
    end if;

    -- ── V5: CASCADE. lessons.continues_lesson_id references lessons ON
    -- DELETE CASCADE, so deleting a row silently deletes its continuations.
    -- GET DIAGNOSTICS counts only directly-matched rows, so a plan to delete
    -- five could remove twelve and still assert "5 = 5". Refuse when a row the
    -- plan did not name would be taken with it.
    select count(*) into v_bad from public.lessons c
     where c.continues_lesson_id = any(p_delete_ids)
       and not (c.id = any(p_delete_ids));
    if v_bad > 0 then
      raise exception
        '% continuation row(s) would cascade-delete with this save but are not in the plan', v_bad
        using errcode = '40001';
    end if;
  end if;

  -- ── STALE PROPOSAL ──────────────────────────────────────────────────────
  -- Recomputed AFTER the locks, so what is compared is the state this
  -- transaction will actually mutate.
  v_now_ver := public.schedule_state_version(v_prop.goal_ids);
  if v_now_ver is distinct from v_prop.state_version then
    raise exception 'the schedule changed since this proposal was made (expected %, now %)',
      v_prop.state_version, v_now_ver using errcode = '40001';
  end if;

  -- Before-images for undo, captured inside the transaction.
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_before
    from public.lessons l where l.curriculum_goal_id = any(v_prop.goal_ids);

  -- ── APPLY. Order matters: pins released before the delete can see them. ──
  if p_release_pins is not null and array_length(p_release_pins, 1) > 0 then
    update public.lessons set queue_pinned = false
     where id = any(p_release_pins) and queue_pinned;
  end if;

  if p_goal_updates is not null then
    for v_goal in select key::uuid from jsonb_each(p_goal_updates) loop
      if not (v_goal = any(v_prop.goal_ids)) then
        raise exception 'goal update names %, which the proposal does not cover', v_goal
          using errcode = '42501';
      end if;
      update public.curriculum_goals g set
        curriculum_name  = coalesce((p_goal_updates->v_goal::text->>'curriculum_name'), g.curriculum_name),
        total_lessons    = coalesce((p_goal_updates->v_goal::text->>'total_lessons')::int, g.total_lessons),
        lessons_per_day  = coalesce((p_goal_updates->v_goal::text->>'lessons_per_day')::int, g.lessons_per_day),
        start_date       = coalesce((p_goal_updates->v_goal::text->>'start_date')::date, g.start_date),
        target_date      = coalesce((p_goal_updates->v_goal::text->>'target_date')::date, g.target_date),
        archived         = coalesce((p_goal_updates->v_goal::text->>'archived')::boolean, g.archived),
        school_days      = coalesce(
                             (select array_agg(x) from jsonb_array_elements_text(
                                 p_goal_updates->v_goal::text->'school_days') t(x)),
                             g.school_days)
       where g.id = v_goal;
    end loop;
  end if;

  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
    delete from public.lessons where id = any(p_delete_ids);
    get diagnostics v_deleted = row_count;
    if v_deleted <> array_length(p_delete_ids, 1) then
      raise exception 'planned to delete % row(s), matched %', array_length(p_delete_ids,1), v_deleted
        using errcode = '40001';
    end if;
  end if;

  if p_insert_rows is not null and jsonb_array_length(p_insert_rows) > 0 then
    -- EXPLICIT COLUMN ALLOWLIST, for two reasons.
    --
    -- 1. jsonb_populate_recordset yields NULL for any column the payload omits,
    --    which is NOT the column default. `created_at` is NOT NULL with a
    --    default, so an omitted key produced "null value in column created_at
    --    violates not-null constraint" rather than now(). Defaults are applied
    --    here explicitly.
    -- 2. A row-shaped payload would otherwise be able to set ANY column,
    --    including ones a client has no business writing. Naming the columns
    --    is the allowlist.
    --
    -- user_id is never taken from the payload: it is forced to the caller.
    insert into public.lessons (
      id, user_id, child_id, curriculum_goal_id, subject_id, school_year_id,
      title, date, scheduled_date, scheduled_source, lesson_number, queue_position,
      queue_pinned, completed, completed_at, notes, minutes_spent, hours,
      is_backfill, skipped, counts_toward_goal, continues_lesson_id,
      created_at, updated_at)
    select
      coalesce((r->>'id')::uuid, gen_random_uuid()),
      v_uid,
      (r->>'child_id')::uuid,
      (r->>'curriculum_goal_id')::uuid,
      (r->>'subject_id')::uuid,
      (r->>'school_year_id')::uuid,
      r->>'title',
      (r->>'date')::date,
      (r->>'scheduled_date')::date,
      r->>'scheduled_source',
      (r->>'lesson_number')::int,
      (r->>'queue_position')::int,
      coalesce((r->>'queue_pinned')::boolean, false),
      coalesce((r->>'completed')::boolean, false),
      (r->>'completed_at')::timestamptz,
      r->>'notes',
      (r->>'minutes_spent')::int,
      coalesce((r->>'hours')::numeric, 0),
      coalesce((r->>'is_backfill')::boolean, false),
      coalesce((r->>'skipped')::boolean, false),
      coalesce((r->>'counts_toward_goal')::boolean, true),
      (r->>'continues_lesson_id')::uuid,
      coalesce((r->>'created_at')::timestamptz, now()),
      coalesce((r->>'updated_at')::timestamptz, now())
      from jsonb_array_elements(p_insert_rows) r;
    get diagnostics v_inserted = row_count;
    if v_inserted <> jsonb_array_length(p_insert_rows) then
      raise exception 'planned to insert % row(s), wrote %', jsonb_array_length(p_insert_rows), v_inserted
        using errcode = '40001';
    end if;
    select count(*) into v_bad from public.lessons
     where id in (select (r->>'id')::uuid from jsonb_array_elements(p_insert_rows) r)
       and (curriculum_goal_id is null or not (curriculum_goal_id = any(v_prop.goal_ids)));
    if v_bad > 0 then
      raise exception '% inserted row(s) fall outside the proposal''s goals', v_bad using errcode = '42501';
    end if;
  end if;

  -- ── POINTERS LAST ───────────────────────────────────────────────────────
  -- The lesson triggers recompute current_lesson as a side effect of the rows
  -- above, so an explicit pointer is applied after them or it would be
  -- overwritten.
  if p_pointers is not null then
    for v_goal in select key::uuid from jsonb_each(p_pointers) loop
      if not (v_goal = any(v_prop.goal_ids)) then
        raise exception 'pointer names %, which the proposal does not cover', v_goal
          using errcode = '42501';
      end if;
      update public.curriculum_goals
         set current_lesson = (p_pointers->v_goal::text)::int
       where id = v_goal;
    end loop;
  end if;

  -- ── RECORD, inside the same transaction as the changes it describes ─────
  -- actor_type / actor_user_id, not the removed free-text `actor` column. The
  -- table's CHECK requires actor_user_id to be present when actor_type is
  -- 'parent', so a save always records WHICH person made it.
  insert into public.schedule_transactions
    (user_id, action, goal_ids, label, impact, preserved,
     actor_type, actor_user_id,
     before_rows, after_version, idempotency_key)
  values
    (v_uid, v_prop.action, v_prop.goal_ids, 'schedule_commit',
     jsonb_build_object('deleted', v_deleted, 'inserted', v_inserted,
                        'pins_released', coalesce(array_length(p_release_pins,1),0),
                        'request_digest', v_digest),
     '{}'::jsonb, 'parent'::actor_type_t, v_uid, v_before,
     public.schedule_state_version(v_prop.goal_ids), p_idempotency_key)
  returning id into v_txn_id;

  update public.schedule_proposals
     set consumed_at = now(), consumed_by_transaction_id = v_txn_id
   where id = p_proposal_id;

  return jsonb_build_object(
    'status', 'committed',
    'transaction_id', v_txn_id,
    'deleted', v_deleted,
    'inserted', v_inserted,
    'after_version', public.schedule_state_version(v_prop.goal_ids));
end;
$$;

revoke all on function public.schedule_commit(uuid, jsonb, uuid[], uuid[], jsonb, jsonb, text) from public, anon;
grant execute on function public.schedule_commit(uuid, jsonb, uuid[], uuid[], jsonb, jsonb, text) to authenticated, service_role;

-- ── 3. The revoke is NOT here ──────────────────────────────────────────────
-- It lives in 20260920000000_contract_revoke_client_delete.sql and must not be
-- applied until the callers are deployed.
--
-- Applying it here would have broken the running app the moment the migration
-- landed: the deployed bundle still deletes directly, and the replacement RPCs
-- did not all exist yet either. Database-first breaks the current app;
-- app-first calls functions that are not there. This file is the EXPAND step
-- and only adds.
