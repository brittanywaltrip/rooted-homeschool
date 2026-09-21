-- Assertion tests for the legacy queue_resync block and its parent-intent
-- heuristic (20260921210738, 20260921210801, 20260921210815).
--
-- Run against rooted-staging ONLY (the fixture user and goal are staging
-- synthetic data). Everything runs in one transaction that always ends in an
-- exception, so nothing it writes is kept:
--   * success ends with   INTENT_RULE_TESTS_PASSED {...}
--   * a failed assertion ends with   ASSERT failed: <which>
-- The PostgREST session is emulated the way PostgREST sets it: SET LOCAL ROLE
-- authenticated plus request.jwt.claims with sub and session_id.
do $t$
declare
  uid  uuid := '11111111-1111-4111-8111-000000000002';          -- e2e@rooted-staging.test
  g    uuid := '55555555-5555-4555-8555-000000000005';          -- Containment harness 5
  h    uuid := '55555555-5555-4555-8555-000000000004';          -- Containment harness 4
  sa   uuid := gen_random_uuid();                               -- session A
  sb   uuid := gen_random_uuid();                               -- session B, same family
  a uuid; b uuid; c uuid; d uuid; x uuid; n int; res jsonb := '{}';
begin
  if (select system_identifier from pg_control_system()) <> 7678069749886157684 then
    raise exception 'not rooted-staging';
  end if;
  -- Fixture: four incomplete, unpinned, legacy-stamped rows on g, one on h.
  update public.lessons set queue_pinned = false, skipped = false, scheduled_source = 'queue_resync'
   where curriculum_goal_id in (g, h) and not completed;
  select id into a from public.lessons where curriculum_goal_id = g and not completed order by lesson_number limit 1;
  select id into b from public.lessons where curriculum_goal_id = g and not completed order by lesson_number offset 1 limit 1;
  select id into c from public.lessons where curriculum_goal_id = g and not completed order by lesson_number offset 2 limit 1;
  select id into d from public.lessons where curriculum_goal_id = g and not completed order by lesson_number offset 3 limit 1;
  select id into x from public.lessons where curriculum_goal_id = h and not completed order by lesson_number limit 1;
  delete from rooted_private.schedule_intent where user_id = uid;
  execute 'set local role authenticated';

  -- 1. No signal: the legacy automatic write is blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sa)::text, true);
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = a;
  get diagnostics n = row_count; assert n = 0, 'no-signal legacy write should be blocked'; res := res || '{"1_no_signal":"blocked"}';

  -- 2. Session A signals (bare unpin, the old re-spread's first write).
  update public.lessons set queue_pinned = false where curriculum_goal_id = g and completed = false;

  -- 3. Same session, same goal, inside the window: passes. This is also what
  --    an AUTOMATIC resync from session A looks like: HEURISTIC EXCEPTION.
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = a;
  get diagnostics n = row_count; assert n = 1, 'same-session write should pass'; res := res || '{"3_same_session":"passes (heuristic)"}';

  -- 4. Same session, a DIFFERENT goal with no signal: blocked.
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = x;
  get diagnostics n = row_count; assert n = 0, 'other-goal write should be blocked'; res := res || '{"4_other_goal":"blocked"}';

  -- 5. Same family, DIFFERENT session (another device or sign-in): blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sb)::text, true);
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = b;
  get diagnostics n = row_count; assert n = 0, 'other-session write should be blocked'; res := res || '{"5_other_session":"blocked"}';

  -- 6. A JWT with no session_id: blocked (fails closed).
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = b;
  get diagnostics n = row_count; assert n = 0, 'no-session_id write should be blocked'; res := res || '{"6_no_session_claim":"blocked"}';

  -- 7. Not consumed: a second legacy write from session A still passes.
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'session_id', sa)::text, true);
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = c;
  get diagnostics n = row_count; assert n = 1, 'intent is not consumed'; res := res || '{"7_not_consumed":"passes"}';

  -- 8. Expired (aged past 10 minutes): blocked.
  execute 'reset role';
  update rooted_private.schedule_intent set recorded_at = now() - interval '11 minutes' where user_id = uid and curriculum_goal_id = g and session_id = sa;
  execute 'set local role authenticated';
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = d;
  get diagnostics n = row_count; assert n = 0, 'expired intent should not apply'; res := res || '{"8_expired":"blocked"}';

  -- 9. Recalibrate's signal (start_at_lesson) opens the same window.
  update public.curriculum_goals set start_at_lesson = start_at_lesson where id = g;
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1, scheduled_source = 'queue_resync' where id = d;
  get diagnostics n = row_count; assert n = 1, 'start_at_lesson should signal'; res := res || '{"9_start_at_lesson_signal":"passes"}';

  -- 10. Forging a signal directly is refused.
  begin
    perform rooted_private.note_schedule_intent(h, 'forged');
    assert false, 'direct note_schedule_intent should be refused';
  exception when insufficient_privilege then res := res || '{"10_forge":"refused"}';
  end;

  -- 11. A date-only write never reaches the rule (does not name the source).
  update public.lessons set scheduled_date = scheduled_date + 1, date = date + 1 where id = x;
  get diagnostics n = row_count; assert n = 1, 'date-only write should land'; res := res || '{"11_date_only":"lands"}';

  execute 'reset role';
  raise exception using message = 'INTENT_RULE_TESTS_PASSED ' || res::text;
end $t$;
