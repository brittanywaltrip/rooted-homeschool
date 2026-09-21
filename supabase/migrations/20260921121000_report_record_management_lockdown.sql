-- Supabase's API roles can carry explicit function grants in addition to the
-- PostgreSQL PUBLIC grant. Keep these owner-scoped correction RPCs completely
-- absent from the anonymous API surface.

revoke all on function public.update_report_lesson_record(uuid,date,integer,text) from anon;
revoke all on function public.delete_report_lesson_record(uuid) from anon;
revoke all on function public.update_report_activity_record(uuid,date,integer,text) from anon;
revoke all on function public.delete_report_activity_record(uuid) from anon;
