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
    -- SAME SHAPE AS A FRESH COMMIT. The counts were only inside `impact`, so a
    -- client reading data.inserted got 0 from a replay -- and the builder then
    -- compared 0 against its planned count and told the parent nothing was
    -- saved, after the save had committed. They are lifted to the top level
    -- here and `impact` is kept for the audit trail.
    return jsonb_build_object(
      'status','already_committed','transaction_id',v_existing.id,
      'deleted',  coalesce((v_existing.impact->>'deleted')::int, 0),
      'inserted', coalesce((v_existing.impact->>'inserted')::int, 0),
      'updated',  coalesce((v_existing.impact->>'updated')::int, 0),
      'impact',v_existing.impact,'after_version',v_existing.after_version);
  end if;

  -- ── PAYLOAD VALIDATION, before any lock or write ───────────────────────
  -- Duplicates are not a stylistic matter here. A repeated delete id makes the
  -- "planned N, matched N" assertion compare a list length against a row count
  -- that can never equal it; a repeated lesson_id in the updates makes which
  -- source row wins nondeterministic; a repeated insert id or slot fails deep
  -- inside the statement with a constraint error instead of a clear refusal.
  if p_delete_ids is not null and array_length(p_delete_ids,1) > 0
     and array_length(p_delete_ids,1) <> (select count(distinct x) from unnest(p_delete_ids) x) then
    raise exception 'the delete list repeats an id' using errcode = '22023';
  end if;

  if p_lesson_updates is not null and jsonb_array_length(p_lesson_updates) > 0 then
    if jsonb_array_length(p_lesson_updates) <>
       (select count(distinct u->>'lesson_id') from jsonb_array_elements(p_lesson_updates) u) then
      raise exception 'the lesson updates repeat a lesson_id' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_lesson_updates) u
                where nullif(u->>'lesson_id','') is null) then
      raise exception 'a lesson update has no lesson_id' using errcode = '22023';
    end if;
    -- An allowlist, so a typo cannot be silently ignored and a column this
    -- operation has no business writing cannot be smuggled in.
    select count(*) into v_bad from (
      select jsonb_object_keys(u) as k from jsonb_array_elements(p_lesson_updates) u) t
     where t.k not in ('lesson_id','scheduled_date','date','queue_position',
                       'queue_pinned','scheduled_source');
    if v_bad > 0 then
      raise exception '% unknown key(s) in the lesson updates', v_bad using errcode = '22023';
    end if;
  end if;

  -- Unknown keys are refused rather than ignored, in every object the payload
  -- carries. A typo in a field name used to be silently dropped: the save
  -- reported success and the value the parent set never arrived.
  if p_goal_updates is not null and p_goal_updates <> '{}'::jsonb then
    select count(*) into v_bad from (
      select jsonb_object_keys(v) as k from jsonb_each(p_goal_updates) e(gid, v)) t
     where t.k not in ('curriculum_name','total_lessons','lessons_per_day',
                       'start_date','target_date','archived','school_days');
    if v_bad > 0 then
      raise exception '% unknown key(s) in the goal updates', v_bad using errcode = '22023';
    end if;
  end if;

  if p_insert_rows is not null and jsonb_array_length(p_insert_rows) > 0 then
    select count(*) into v_bad from (
      select jsonb_object_keys(r) as k from jsonb_array_elements(p_insert_rows) r) t
     where t.k not in ('id','child_id','curriculum_goal_id','subject_id','school_year_id',
                       'title','date','scheduled_date','scheduled_source','lesson_number',
                       'queue_position','queue_pinned','completed','completed_at','notes',
                       'minutes_spent','hours','is_backfill','skipped','counts_toward_goal',
                       'continues_lesson_id','created_at','updated_at');
    if v_bad > 0 then
      raise exception '% unknown key(s) in the inserted rows', v_bad using errcode = '22023';
    end if;

    if jsonb_array_length(p_insert_rows) <>
       (select count(distinct r->>'id') from jsonb_array_elements(p_insert_rows) r) then
      raise exception 'the insert rows repeat an id' using errcode = '22023';
    end if;
    if jsonb_array_length(p_insert_rows) <>
       (select count(distinct (r->>'curriculum_goal_id') || ':' || coalesce(r->>'lesson_number','~'))
          from jsonb_array_elements(p_insert_rows) r) then
      raise exception 'two inserted rows claim the same queue slot' using errcode = '22023';
    end if;
  end if;

  -- ── THE ACCOUNT LOCK, FIRST. LOCK ORDER IS THE POINT. ──────────────────
  -- vacation_blocks.user_id references auth.users(id), so INSERTing a vacation
  -- takes FOR KEY SHARE on this row, and FOR KEY SHARE conflicts with FOR
  -- UPDATE. Holding it is what makes a concurrent vacation insert WAIT rather
  -- than slip in behind the state-version check -- FOR UPDATE cannot lock a
  -- vacation row that does not exist yet.
  --
  -- IT MUST BE TAKEN BEFORE THE PROPOSAL, GOAL, LESSON AND VACATION LOCKS.
  -- Taken after them, this deadlocks: a concurrent insert acquires FOR KEY
  -- SHARE on auth.users as part of its own FK check, then waits on a goal or
  -- lesson row this transaction already holds, while this transaction waits on
  -- that transaction's auth.users lock. Two waiters, opposite order, a cycle.
  -- Every writer that reaches this account's rows passes through auth.users on
  -- its way in, so taking it first gives every transaction the same order.
  --
  -- THE COST, stated: for the length of this transaction -- validate, write,
  -- commit -- any concurrent INSERT into a table whose user_id references
  -- auth.users(id) for THIS account waits. That is goals, lessons,
  -- transcripts, vacations. Other accounts are untouched: it is one row.
  -- Anything else that UPDATEs this auth.users row would wait too; what the
  -- package demonstrates is the FK key-share behaviour, and no claim is made
  -- here about what Supabase Auth does or does not write during a token
  -- refresh, which has not been observed.
  perform 1 from auth.users where id = v_uid for update;

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
       and (completed
            or (notes is not null and btrim(notes) <> '')
            or minutes_spent is not null
            -- hours is parent-entered work too. Adding it to the state digest
            -- protected a CONCURRENT hours edit; it did nothing for a row that
            -- already held hours when the proposal was sealed, which stayed
            -- eligible for deletion the whole time.
            or coalesce(hours, 0) > 0);
    if v_bad > 0 then
      raise exception
        '% row(s) in this save carry work that must not be deleted (completed, or holding notes, minutes or hours). Rebuild the proposal.', v_bad
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

  -- ── LOCK WHAT THE CHECK PROTECTS ────────────────────────────────────────
  -- Locking only the goals left a race the hash could not see: a concurrent
  -- title, hours, notes, minutes, pin or skip edit does not touch the goal
  -- row, so it could commit AFTER schedule_state_version was computed and
  -- BEFORE the delete ran, and be destroyed without anything going stale.
  --
  -- So every lesson under the proposal's goals is locked here, in id order to
  -- keep two concurrent saves from deadlocking, and the vacation rows too
  -- because they are part of the same digest. The locks are taken BEFORE the
  -- version is computed and held to COMMIT, so what is hashed is what is
  -- written.
  perform 1 from public.lessons
    where curriculum_goal_id = any(v_prop.goal_ids) order by id for update;

  -- EXISTING vacation rows. Necessary, and on its own not sufficient: FOR
  -- UPDATE cannot lock a row that does not exist yet, so a vacation INSERTED
  -- after this point could still commit between the hash and the delete and
  -- change which days the save should have used.
  perform 1 from public.vacation_blocks
    where user_id = v_uid order by id for update;


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
    -- small.
    --
    -- CORRECTION to an earlier note here: batching is NOT incompatible with
    -- atomicity. Several statements, or chunked set-based inserts, run happily
    -- inside one transaction. The reason this takes a single array is simpler
    -- and worth stating accurately: one RPC call is one round trip and one
    -- payload to hash for idempotency, and the count assertion is a single
    -- comparison rather than a running total across chunks.
    --
    -- What a single array does need is a ceiling, since the whole payload is
    -- parsed at once. 5000 matches schedule_seal_proposal's placement limit. A
    -- real curriculum is a few hundred rows; anything near this is a bug
    -- upstream, and failing loudly beats a request that times out half way.
    if jsonb_array_length(p_insert_rows) > 5000 then
      raise exception 'refusing to insert % rows in one save (limit 5000)',
        jsonb_array_length(p_insert_rows) using errcode = '22023';
    end if;
    -- ── REFERENCES VALIDATED BEFORE THE INSERT ──────────────────────────
    -- The post-insert checks below still run, but they are defence in depth,
    -- not the front line. Letting the INSERT go first has two problems:
    --
    --   1. A foreign key error distinguishes "no such id" from "an id that
    --      exists but belongs to another family" -- the constraint fires only
    --      in the first case -- so the pair of outcomes is an oracle for
    --      whether another account owns a given uuid.
    --   2. The lessons INSERT triggers run BEFORE any post-insert refusal:
    --      lessons_child_id_matches_goal raises its own message naming the
    --      goal, and trg_lessons_recompute_current_lesson has already
    --      recomputed a pointer, inside a transaction that is about to abort.
    --
    -- Reading the ids straight out of the payload settles both: every
    -- reference is checked against the caller before a row is written, and
    -- every failure gives the same answer regardless of why.
    select count(*) into v_bad
      from jsonb_array_elements(p_insert_rows) r
     where
       -- the goal must be the caller's AND inside the proposal
       (nullif(r->>'curriculum_goal_id','') is null
        or not ((r->>'curriculum_goal_id')::uuid = any(v_prop.goal_ids)))
    or (nullif(r->>'child_id','') is not null and not exists (
          select 1 from public.children c
           where c.id = (r->>'child_id')::uuid and c.user_id = v_uid))
    or (nullif(r->>'subject_id','') is not null and not exists (
          select 1 from public.subjects sj
           where sj.id = (r->>'subject_id')::uuid and sj.user_id = v_uid))
    or (nullif(r->>'school_year_id','') is not null and not exists (
          select 1 from public.school_years y
           where y.id = (r->>'school_year_id')::uuid and y.user_id = v_uid))
    or (nullif(r->>'continues_lesson_id','') is not null and not exists (
          select 1 from public.lessons cl
           where cl.id = (r->>'continues_lesson_id')::uuid and cl.user_id = v_uid));
    if v_bad > 0 then
      raise exception
        '% inserted row(s) reference a curriculum, child, subject, school year or continued lesson that is missing or not yours', v_bad
        using errcode = '42501';
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

    -- The row's user_id is forced to the caller, but its FOREIGN KEYS are not:
    -- child_id, subject_id and school_year_id come from the payload, and this
    -- function is SECURITY DEFINER, so RLS will not check them. A row could
    -- otherwise be attached to another family's child. Verified against the
    -- rows as inserted, so a NULL is allowed and anything present must be the
    -- caller's.
    select count(*) into v_bad from public.lessons l
     where l.id in (select (r->>'id')::uuid from jsonb_array_elements(p_insert_rows) r)
       and (
         (l.child_id is not null and not exists (
            select 1 from public.children c where c.id = l.child_id and c.user_id = v_uid))
      or (l.subject_id is not null and not exists (
            select 1 from public.subjects sj where sj.id = l.subject_id and sj.user_id = v_uid))
      or (l.school_year_id is not null and not exists (
            select 1 from public.school_years y where y.id = l.school_year_id and y.user_id = v_uid))
      -- continues_lesson_id was missing from this check. Without it a payload
      -- could create a lesson that continues from ANOTHER FAMILY'S lesson --
      -- and because that FK is ON DELETE CASCADE, deleting their row would
      -- then delete ours, or ours theirs, depending which way the link ran.
      --
      -- DECISION on same-account, out-of-proposal targets: ALLOWED. A
      -- continuation legitimately spans curricula ("this carries on from the
      -- lesson we did in the other book"), and the proposal's goal scope is
      -- about what this save may REWRITE, not about what a row may point at.
      -- The target is never written by this call. What is refused is a target
      -- that is missing, or that belongs to someone else.
      or (l.continues_lesson_id is not null and not exists (
            select 1 from public.lessons cl
             where cl.id = l.continues_lesson_id and cl.user_id = v_uid))
       );
    if v_bad > 0 then
      raise exception
        '% inserted row(s) reference a child, subject, school year or continued lesson that is missing or not yours', v_bad
        using errcode = '42501';
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
