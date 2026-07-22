-- Lock down recompute_curriculum_current_lesson: it is only called internally
-- by the lessons trigger (SECURITY DEFINER, owned by postgres) and is never
-- called from the browser. Previously any signed-in user could call it via
-- /rest/v1/rpc against any goal_id. Applied to the live DB 2026-07-21;
-- this file is a record so fresh environments build the same grants.
REVOKE EXECUTE ON FUNCTION public.recompute_curriculum_current_lesson(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_curriculum_current_lesson(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_curriculum_current_lesson(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_curriculum_current_lesson(uuid) TO service_role;
