-- Assertion tests for 20260928205411_lessons_completion_needs_a_person.
--
-- Replays the 2026-09-25 incident on staging synthetic data, then checks every
-- path that may legitimately mark a lesson done still can.
--
-- Run against rooted-staging ONLY. Everything runs in one transaction that
-- always ends in an exception, so nothing it writes is kept:
--   * success ends with   COMPLETION_PERSON_TESTS_PASSED {...}
--   * a failed assertion ends with   ASSERT failed: <which>
-- The PostgREST session is emulated the way PostgREST sets it: SET LOCAL ROLE
-- plus request.jwt.claims.
do $t$
declare
  uid  uuid := '11111111-1111-4111-8111-000000000002';          -- e2e@rooted-staging.test
  g    uuid := '55555555-5555-4555-8555-000000000001';          -- Containment harness 1
  l7 uuid; l8 uuid; l9 uuid; l10 uuid; d8 date;
  n int; ok boolean; res jsonb := '{}';
  r record;
begin
  if (select system_identifier from pg_control_system()) <> 7678069749886157684 then
    raise exception 'not rooted-staging';
  end if;

  -- Fixture: lessons 7..10 open, unpinned, in book order, one per school day.
  select id into l7  from public.lessons where curriculum_goal_id = g and lesson_number = 7;
  select id into l8  from public.lessons where curriculum_goal_id = g and lesson_number = 8;
  select id into l9  from public.lessons where curriculum_goal_id = g and lesson_number = 9;
  select id into l10 from public.lessons where curriculum_goal_id = g and lesson_number = 10;
  assert (select count(*) from public.lessons where id in (l7, l8, l9, l10)
            and not completed and queue_position = lesson_number) = 4, 'fixture: 7..10 open and in slot order';
  update public.lessons set queue_pinned = false, notes = null where id in (l7, l8, l9, l10);
  select scheduled_date into d8 from public.lessons where id = l8;

  -- ── The incident, step by step, as the family's own session ──────────────
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);

  -- 1. Plan drag (the pre-#102 path, still used for earlier-day moves):
  --    lesson 7 onto lesson 8's day. The two swap queue slots.
  perform public.move_lesson_to_date(l7, d8);
  assert (select queue_position from public.lessons where id = l7) = 8, 'drag: lesson 7 takes slot 8';
  assert (select queue_position from public.lessons where id = l8) = 7, 'drag: lesson 8 takes slot 7';
  res := res || '{"1_drag_swaps_slots":true}';

  -- 2. The family ticks lesson 7 on Today. The pointer is MAX(slot) = 8, so
  --    it jumps over lesson 8, which nobody has done.
  update public.lessons set completed = true, completed_at = now() where id = l7;
  get diagnostics n = row_count; assert n = 1, 'family completion lands';
  assert (select current_lesson from public.curriculum_goals where id = g) = 8, 'pointer jumps to 8';
  assert (select not completed from public.lessons where id = l8), 'lesson 8 still open behind the pointer';
  res := res || '{"2_family_completion":"allowed, pointer 8"}';

  -- ── 3. The 2026-09-25 drift-G auto-heal, verbatim, as the MCP runs it ────
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.lessons l
       set completed = true,
           completed_at = (now() - interval '1 day')::timestamptz,
           queue_position = null
      from public.curriculum_goals cg
     where l.curriculum_goal_id = cg.id
       and cg.id = g
       and l.completed = false
       and l.lesson_number is not null
       and l.lesson_number <= cg.current_lesson
       and (l.notes is null or l.notes = '');
    raise exception 'ASSERT failed: auto-heal completion was NOT refused';
  exception when check_violation then
    res := res || jsonb_build_object('3_auto_heal', 'refused: ' || left(sqlerrm, 60));
  end;
  select completed, queue_position into r from public.lessons where id = l8;
  assert not r.completed and r.queue_position = 7, 'lesson 8 untouched: still open, still slot 7';

  -- 4. A plain postgres completion with no reason is refused too.
  begin
    update public.lessons set completed = true, completed_at = now() where id = l9;
    raise exception 'ASSERT failed: bare postgres completion was NOT refused';
  exception when check_violation then
    res := res || '{"4_bare_postgres":"refused"}';
  end;

  -- 5. A postgres INSERT of a completed row is refused.
  begin
    insert into public.lessons (user_id, curriculum_goal_id, title, lesson_number, scheduled_date, date, completed, completed_at, hours)
    values (uid, g, 'fabricated', null, current_date, current_date, true, now(), 0);
    raise exception 'ASSERT failed: postgres completed INSERT was NOT refused';
  exception when check_violation then
    res := res || '{"5_postgres_insert":"refused"}';
  end;

  -- ── Paths that must still work ───────────────────────────────────────────
  -- 6. An attested repair in the SQL editor.
  begin
    perform set_config('rooted.completion_attested', 'test: reviewed repair', true);
    update public.lessons set completed = true, completed_at = now() where id = l9;
    get diagnostics n = row_count; assert n = 1, 'attested completion lands';
    res := res || '{"6_attested":"allowed"}';
    raise exception 'undo_6';
  exception when raise_exception then
    if sqlerrm <> 'undo_6' then raise; end if;
  end;
  perform set_config('rooted.completion_attested', '', true);
  -- An attestation that is only whitespace is no attestation.
  begin
    perform set_config('rooted.completion_attested', '   ', true);
    update public.lessons set completed = true, completed_at = now() where id = l9;
    raise exception 'ASSERT failed: blank attestation was accepted';
  exception when check_violation then
    res := res || '{"6b_blank_attestation":"refused"}';
  end;
  perform set_config('rooted.completion_attested', '', true);

  -- 7. The service_role key (server code, repair scripts, e2e seeding).
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    update public.lessons set completed = true, completed_at = now() where id = l9;
    get diagnostics n = row_count; assert n = 1, 'service_role completion lands';
    insert into public.lessons (user_id, curriculum_goal_id, title, lesson_number, scheduled_date, date, completed, completed_at, hours)
    values (uid, g, 'service seed', null, current_date, current_date, true, now(), 0);
    res := res || '{"7_service_role":"allowed"}';
    raise exception 'undo_7';
  exception when raise_exception then
    if sqlerrm <> 'undo_7' then raise; end if;
  end;
  execute 'reset role';

  -- 7b. The scheduled task's path with SET ROLE service_role but no key
  --     claims (what an MCP session can do): still refused.
  begin
    execute 'set local role service_role';
    perform set_config('request.jwt.claims', '', true);
    update public.lessons l
       set completed = true, completed_at = (now() - interval '1 day')::timestamptz, queue_position = null
      from public.curriculum_goals cg
     where l.curriculum_goal_id = cg.id and cg.id = g and l.completed = false
       and l.lesson_number is not null and l.lesson_number <= cg.current_lesson
       and (l.notes is null or l.notes = '');
    raise exception 'ASSERT failed: SET ROLE service_role auto-heal was NOT refused';
  exception when check_violation then
    res := res || '{"7b_set_role_service_no_claims":"refused"}';
  end;
  execute 'reset role';

  -- 8. A SECURITY DEFINER RPC called by the family runs as postgres but
  --    carries the family's claims: allowed.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    update public.lessons set completed = true, completed_at = now() where id = l9;
    get diagnostics n = row_count; assert n = 1, 'definer-with-claims completion lands';
    res := res || '{"8_definer_with_family_claims":"allowed"}';
    raise exception 'undo_8';
  exception when raise_exception then
    if sqlerrm <> 'undo_8' then raise; end if;
  end;

  -- 9. Another family's claims cannot complete this family's lesson, even as
  --    postgres (RLS would stop the browser first; this is the trigger's own
  --    check).
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    update public.lessons set completed = true, completed_at = now() where id = l9;
    raise exception 'ASSERT failed: another user''s claims completed the lesson';
  exception when check_violation then
    res := res || '{"9_other_family_claims":"refused"}';
  end;
  perform set_config('request.jwt.claims', '', true);

  -- 10. Un-completing is not affected.
  update public.lessons set completed = false, completed_at = null where id = l7;
  get diagnostics n = row_count; assert n = 1, 'uncomplete as postgres still lands';
  res := res || '{"10_uncomplete":"allowed"}';

  raise exception 'COMPLETION_PERSON_TESTS_PASSED %', res;
end
$t$;
