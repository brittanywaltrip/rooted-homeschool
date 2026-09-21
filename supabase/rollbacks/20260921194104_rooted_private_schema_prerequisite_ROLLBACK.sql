-- Rollback for 20260921194104_rooted_private_schema_prerequisite.
--
-- Only after every containment rollback (block, intent, session scope,
-- audit) has run AND their kept tables have been exported and dropped. It is
-- RESTRICT on purpose: it refuses while anything still lives in the schema.
-- Leaving an empty schema in place is harmless and is the default.
drop schema if exists rooted_private restrict;
