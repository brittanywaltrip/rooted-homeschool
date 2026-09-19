-- ============================================================================
-- schedule_commit: carry the WHOLE builder save, not just delete + insert.
-- ============================================================================
-- The builder's per-goal COMMIT does six kinds of write:
--
--   1. release pins            update queue_pinned = false
--   2. floor delete            the rows being re-spread
--   3. insert history + forward
--   4. unschedule over-ceiling rows that carry the parent's notes or minutes
--   5. delete over-ceiling rows that do not
--   6. re-date the held-back rows onto their slot's projected day
--
-- plus the goal fields and the pointer. The previous signature could express
-- 2, 3, the goal fields, the pointer, and pin release only. Everything else
-- would have stayed outside the transaction -- which would have made the save
-- "atomic" in name while still able to leave a goal half-written.
--
-- p_lesson_updates replaces p_release_pins and covers 1, 4 and 6 with one
-- allowlisted shape: [{lesson_id, scheduled_date, date, queue_position,
-- queue_pinned, scheduled_source}, ...]. Only those columns can be written.
-- lesson_number is deliberately NOT writable: moving a row between queue slots
-- is not something a re-spread is entitled to do silently.
--
-- THE PROTECTION GUARD IS NARROWED, deliberately.
--
-- It refused deleting a row that was completed, pinned, skipped, or carried
-- notes or minutes. But the over-ceiling cleanup is SUPPOSED to delete pinned
-- rows: shortening a curriculum to 100 lessons retires lesson 120 whether or
-- not it was hand-placed, and a pin cannot mean "this lesson still exists".
-- Keeping pins in the guard would have made a legitimate save impossible.
--
-- So the guard now covers CONTENT the parent cannot get back -- completed,
-- notes, minutes_spent -- and placement is covered a different way:
-- queue_pinned and skipped are both hashed by schedule_state_version, so a
-- concurrent pin or skip invalidates the proposal and the save refuses on the
-- stale path instead. Content is guarded twice; placement once, by the check
-- that can see a change the client never read.
-- ============================================================================

drop function if exists public.schedule_commit(uuid, jsonb, uuid[], uuid[], jsonb, jsonb, text);

create or replace function public.schedule_commit(
  p_proposal_id     uuid,
  p_goal_updates    jsonb,   -- {goal_id: {field: value, ...}}
  p_lesson_updates  jsonb,   -- [{lesson_id, ...allowlisted fields}]
  p_delete_ids      uuid[],
  p_insert_rows     jsonb,
  p_pointers        jsonb,   -- {goal_id: current_lesson}
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_prop     public.schedule_proposals%rowtype;
  v_now_ver  text;
  v_txn_id   uuid;
  v_existing public.schedule_transactions%rowtype;
  v_before   jsonb;
  v_deleted  int := 0;
  v_inserted int := 0;
  v_updated  int := 0;
  v_goal     uuid;
  v_bad      int;
  v_digest   text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'an idempotency key of at least 8 characters is required'
      using errcode = '22023';
  end if;

  -- THE PAYLOAD, NOT THE ENVELOPE. p_proposal_id is deliberately excluded.
  -- A retry after an uncertain response re-seals -- the client cannot reuse a
  -- proposal it does not know was consumed -- so the proposal id legitimately
  -- differs between the first attempt and its retry. Including it made every
  -- genuine retry look like "same key, different request" and refused it,
  -- which is the exact case the key exists to serve. What must match is what
  -- the save would DO; the proposal is validated on its own terms above.
  v_digest := encode(sha256(convert_to(
      coalesce(p_goal_updates::text,'') || '|' ||
      coalesce(p_lesson_updates::text,'') || '|' || coalesce(array_to_string(p_delete_ids, ','),'') || '|' ||
      coalesce(p_insert_rows::text,'') || '|' || coalesce(p_pointers::text,''), 'UTF8')), 'hex');

  select * into v_existing from public.schedule_transactions
   where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if coalesce(v_existing.impact->>'request_digest','') is distinct from v_digest then
      raise exception
        'idempotency key % was already used for a different request. A key identifies one request; use a new key.', p_idempotency_key
        using errcode = '22023';
    end if;
    return jsonb_build_object('status','already_committed','transaction_id',v_existing.id,
                              'impact',v_existing.impact,'after_version',v_existing.after_version);
  end if;

  select * into v_prop from public.schedule_proposals where id = p_proposal_id for update;
  if not found or v_prop.user_id is distinct from v_uid then
    raise exception 'proposal not found' using errcode = '42501';
  end if;
  if v_prop.consumed_at is not null then
    raise exception 'proposal % was already consumed', p_proposal_id using errcode = '40001';
  end if;
  if v_prop.expires_at <= now() then
    raise exception 'proposal % expired at %', p_proposal_id, v_prop.expires_at using errcode = '40001';
  end if;

  perform 1 from public.curriculum_goals
    where id = any(v_prop.goal_ids) order by id for update;

  select count(*) into v_bad from public.curriculum_goals
   where id = any(v_prop.goal_ids) and user_id is distinct from v_uid;
  if v_bad > 0 then
    raise exception 'proposal names % goal(s) that are not yours', v_bad using errcode = '42501';
  end if;
  select count(*) into v_bad from public.curriculum_goals where id = any(v_prop.goal_ids);
  if v_bad <> coalesce(array_length(v_prop.goal_ids, 1), 0) then
    raise exception 'a goal named by the proposal no longer exists' using errcode = '40001';
  end if;

  -- Every id handed in must be the caller's AND inside the proposal's goals.
  if p_delete_ids is not null and array_length(p_delete_ids, 1) > 0 then
    select count(*) into v_bad from public.lessons
     where id = any(p_delete_ids)
       and (user_id is distinct from v_uid or curriculum_goal_id is null
            or not (curriculum_goal_id = any(v_prop.goal_ids)));
    if v_bad > 0 then
      raise exception '% delete id(s) are not yours or lie outside the proposal''s goals', v_bad
        using errcode = '42501';
    end if;

    -- CONTENT the parent cannot get back. Placement (pinned/skipped) is
    -- covered by the state version instead; see the header.
    select count(*) into v_bad from public.lessons
     where id = any(p_delete_ids)
       and (completed or (notes is not null and btrim(notes) <> '') or minutes_spent is not null);
    if v_bad > 0 then
      raise exception
        '% row(s) in this save carry work that must not be deleted (completed, or holding notes or minutes). Rebuild the proposal.', v_bad
        using errcode = '40001';
    end if;

    -- lessons.continues_lesson_id cascades; a row the plan did not name must
    -- not be taken with it. GET DIAGNOSTICS cannot see cascaded rows.
    select count(*) into v_bad from public.lessons c
     where c.continues_lesson_id = any(p_delete_ids) and not (c.id = any(p_delete_ids));
    if v_bad > 0 then
      raise exception '% continuation row(s) would cascade-delete but are not in the plan', v_bad
        using errcode = '40001';
    end if;
  end if;

  if p_lesson_updates is not null and jsonb_array_length(p_lesson_updates) > 0 then
    select count(*) into v_bad
      from jsonb_array_elements(p_lesson_updates) u
      left join public.lessons l on l.id = (u->>'lesson_id')::uuid
     where l.id is null or l.user_id is distinct from v_uid
        or l.curriculum_goal_id is null or not (l.curriculum_goal_id = any(v_prop.goal_ids));
    if v_bad > 0 then
      raise exception '% lesson update(s) are not yours or lie outside the proposal''s goals', v_bad
        using errcode = '42501';
    end if;
  end if;

  v_now_ver := public.schedule_state_version(v_prop.goal_ids);
  if v_now_ver is distinct from v_prop.state_version then
    raise exception 'the schedule changed since this proposal was made (expected %, now %)',
      v_prop.state_version, v_now_ver using errcode = '40001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_before
    from public.lessons l where l.curriculum_goal_id = any(v_prop.goal_ids);

  -- ── APPLY ───────────────────────────────────────────────────────────────
  -- Updates first: pins are released before the delete can see them, and the
  -- over-ceiling rows that keep the parent's words are unscheduled before the
  -- rest of that band is removed.
  if p_lesson_updates is not null and jsonb_array_length(p_lesson_updates) > 0 then
    update public.lessons l set
      scheduled_date   = case when u.j ? 'scheduled_date'   then (u.j->>'scheduled_date')::date   else l.scheduled_date end,
      date             = case when u.j ? 'date'             then (u.j->>'date')::date             else l.date end,
      queue_position   = case when u.j ? 'queue_position'   then (u.j->>'queue_position')::int    else l.queue_position end,
      queue_pinned     = case when u.j ? 'queue_pinned'     then (u.j->>'queue_pinned')::boolean  else l.queue_pinned end,
      scheduled_source = case when u.j ? 'scheduled_source' then  u.j->>'scheduled_source'        else l.scheduled_source end
      from (select e as j, (e->>'lesson_id')::uuid as id from jsonb_array_elements(p_lesson_updates) e) u
     where l.id = u.id;
    get diagnostics v_updated = row_count;
  end if;

  if p_goal_updates is not null then
    for v_goal in select key::uuid from jsonb_each(p_goal_updates) loop
      if not (v_goal = any(v_prop.goal_ids)) then
        raise exception 'goal update names %, which the proposal does not cover', v_goal using errcode = '42501';
      end if;
      update public.curriculum_goals g set
        curriculum_name = coalesce((p_goal_updates->v_goal::text->>'curriculum_name'), g.curriculum_name),
        total_lessons   = coalesce((p_goal_updates->v_goal::text->>'total_lessons')::int, g.total_lessons),
        lessons_per_day = coalesce((p_goal_updates->v_goal::text->>'lessons_per_day')::int, g.lessons_per_day),
        start_date      = coalesce((p_goal_updates->v_goal::text->>'start_date')::date, g.start_date),
        target_date     = coalesce((p_goal_updates->v_goal::text->>'target_date')::date, g.target_date),
        archived        = coalesce((p_goal_updates->v_goal::text->>'archived')::boolean, g.archived),
        school_days     = coalesce((select array_agg(x) from jsonb_array_elements_text(
                                      p_goal_updates->v_goal::text->'school_days') t(x)), g.school_days)
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
    -- The client used to insert in batches of 500 to keep any one request
    -- small. Batching is incompatible with atomicity -- the whole point is that
    -- the rows land together or not at all -- so the rows come in one array and
    -- the size is capped instead. 5000 matches schedule_seal_proposal's own
    -- placement ceiling. A real curriculum is a few hundred rows; anything near
    -- this limit is a bug upstream, and failing loudly beats a request that
    -- times out half way.
    if jsonb_array_length(p_insert_rows) > 5000 then
      raise exception 'refusing to insert % rows in one save (limit 5000)',
        jsonb_array_length(p_insert_rows) using errcode = '22023';
    end if;
    insert into public.lessons (
      id, user_id, child_id, curriculum_goal_id, subject_id, school_year_id,
      title, date, scheduled_date, scheduled_source, lesson_number, queue_position,
      queue_pinned, completed, completed_at, notes, minutes_spent, hours,
      is_backfill, skipped, counts_toward_goal, continues_lesson_id, created_at, updated_at)
    select
      coalesce((r->>'id')::uuid, gen_random_uuid()), v_uid,
      (r->>'child_id')::uuid, (r->>'curriculum_goal_id')::uuid, (r->>'subject_id')::uuid,
      (r->>'school_year_id')::uuid, r->>'title', (r->>'date')::date,
      (r->>'scheduled_date')::date, r->>'scheduled_source',
      (r->>'lesson_number')::int, (r->>'queue_position')::int,
      coalesce((r->>'queue_pinned')::boolean, false),
      coalesce((r->>'completed')::boolean, false), (r->>'completed_at')::timestamptz,
      r->>'notes', (r->>'minutes_spent')::int, coalesce((r->>'hours')::numeric, 0),
      coalesce((r->>'is_backfill')::boolean, false), coalesce((r->>'skipped')::boolean, false),
      coalesce((r->>'counts_toward_goal')::boolean, true), (r->>'continues_lesson_id')::uuid,
      coalesce((r->>'created_at')::timestamptz, now()), coalesce((r->>'updated_at')::timestamptz, now())
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

  if p_pointers is not null then
    for v_goal in select key::uuid from jsonb_each(p_pointers) loop
      if not (v_goal = any(v_prop.goal_ids)) then
        raise exception 'pointer names %, which the proposal does not cover', v_goal using errcode = '42501';
      end if;
      update public.curriculum_goals set current_lesson = (p_pointers->v_goal::text)::int where id = v_goal;
    end loop;
  end if;

  insert into public.schedule_transactions
    (user_id, action, goal_ids, label, impact, preserved, actor_type, actor_user_id,
     before_rows, after_version, idempotency_key)
  values
    (v_uid, v_prop.action, v_prop.goal_ids, 'schedule_commit',
     jsonb_build_object('deleted',v_deleted,'inserted',v_inserted,'updated',v_updated,
                        'request_digest',v_digest),
     '{}'::jsonb, 'parent'::actor_type_t, v_uid, v_before,
     public.schedule_state_version(v_prop.goal_ids), p_idempotency_key)
  returning id into v_txn_id;

  update public.schedule_proposals
     set consumed_at = now(), consumed_by_transaction_id = v_txn_id
   where id = p_proposal_id;

  return jsonb_build_object('status','committed','transaction_id',v_txn_id,
    'deleted',v_deleted,'inserted',v_inserted,'updated',v_updated,
    'after_version', public.schedule_state_version(v_prop.goal_ids));
end;
$$;

revoke all on function public.schedule_commit(uuid, jsonb, jsonb, uuid[], jsonb, jsonb, text) from public, anon;
grant execute on function public.schedule_commit(uuid, jsonb, jsonb, uuid[], jsonb, jsonb, text) to authenticated, service_role;
