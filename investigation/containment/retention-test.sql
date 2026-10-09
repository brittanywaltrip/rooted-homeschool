-- Synthetic transaction only; rollback also reverses any preexisting expired
-- receipts visited by maintenance. No family lesson/goal rows are touched.
BEGIN;
DO $$
DECLARE a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();u uuid:=gen_random_uuid();g uuid:=gen_random_uuid();lesson uuid:=gen_random_uuid();r rooted_private.scheduler_action_receipts%rowtype;k rooted_private.scheduler_calendar_receipts%rowtype;n integer:=0;
BEGIN
 INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result,created_at)
 VALUES(a,u,g,'synthetic-request','{"rows":[{"notes":"synthetic short-lived"}]}','synthetic-after',jsonb_build_object('status','applied','kind','continue','written',1,'row',jsonb_build_object('id',lesson,'title','synthetic short-lived')),'2000-01-01');
 INSERT INTO rooted_private.scheduler_calendar_receipts(id,user_id,request_hash,before_state,after_state,after_hash,result,created_at)
 VALUES(c,u,'synthetic-calendar-request','{"rows":[]}','{"rows":[]}','synthetic-calendar-after','{"status":"applied","written":0}','2000-01-01');
 LOOP
  PERFORM rooted_private.expire_scheduler_receipts(1);n:=n+1;
  EXIT WHEN NOT EXISTS(SELECT 1 FROM rooted_private.scheduler_action_receipts WHERE id=a AND result?'row') AND NOT EXISTS(SELECT 1 FROM rooted_private.scheduler_calendar_receipts WHERE id=c AND before_state IS NOT NULL);
  IF n>100 THEN RAISE EXCEPTION 'synthetic maintenance backlog exceeded';END IF;
 END LOOP;
 SELECT * INTO r FROM rooted_private.scheduler_action_receipts WHERE id=a;
 IF r.before_state IS NOT NULL OR r.result?'row' OR r.result->>'rowId' IS DISTINCT FROM lesson::text OR r.request_hash<>'synthetic-request' OR r.after_hash<>'synthetic-after' OR r.result->>'status'<>'applied' OR r.result->>'written'<>'1' THEN RAISE EXCEPTION 'action retention failed';END IF;
 SELECT * INTO k FROM rooted_private.scheduler_calendar_receipts WHERE id=c;
 IF k.before_state IS NOT NULL OR k.after_state IS NOT NULL OR k.request_hash<>'synthetic-calendar-request' OR k.after_hash<>'synthetic-calendar-after' OR k.result IS DISTINCT FROM '{"status":"applied","written":0}'::jsonb THEN RAISE EXCEPTION 'calendar retention failed';END IF;
 IF has_function_privilege('authenticated','rooted_private.expire_scheduler_receipts(integer)','EXECUTE') OR has_function_privilege('anon','rooted_private.expire_scheduler_receipts(integer)','EXECUTE') OR has_function_privilege('service_role','rooted_private.expire_scheduler_receipts(integer)','EXECUTE') THEN RAISE EXCEPTION 'maintenance ACL failed';END IF;
 RAISE NOTICE 'PASS bounded payload scrubbing preserves durable replay proof and private ACL';
END $$;
ROLLBACK;
