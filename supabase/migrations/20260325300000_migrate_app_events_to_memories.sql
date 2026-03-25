-- Migrate existing memory data from app_events into the new memories table.
-- Safe to run multiple times: skips rows whose (user_id, created_at, type) already exist.

INSERT INTO memories (user_id, child_id, date, type, title, caption, photo_url, include_in_book, created_at, updated_at)
SELECT
  ae.user_id,
  (ae.payload ->> 'child_id')::uuid,
  COALESCE(
    (ae.payload ->> 'date')::date,
    ae.created_at::date
  ),
  CASE ae.type
    WHEN 'memory_photo'      THEN 'photo'
    WHEN 'memory_book'       THEN 'book'
    WHEN 'book_read'         THEN 'book'
    WHEN 'memory_project'    THEN 'project'
    WHEN 'memory_field_trip' THEN 'field_trip'
    WHEN 'memory_activity'   THEN 'activity'
    ELSE 'photo'
  END,
  COALESCE(
    ae.payload ->> 'title',
    ae.payload ->> 'name',
    'Untitled'
  ),
  COALESCE(
    ae.payload ->> 'description',
    CASE WHEN ae.payload ->> 'author' IS NOT NULL
      THEN 'by ' || (ae.payload ->> 'author')
      ELSE NULL
    END
  ),
  ae.payload ->> 'photo_url',
  false,
  ae.created_at,
  ae.created_at
FROM app_events ae
WHERE ae.type IN (
  'memory_photo',
  'memory_book',
  'book_read',
  'memory_project',
  'memory_field_trip',
  'memory_activity'
)
AND NOT EXISTS (
  SELECT 1 FROM memories m
  WHERE m.user_id = ae.user_id
    AND m.created_at = ae.created_at
    AND m.type = CASE ae.type
      WHEN 'memory_photo'      THEN 'photo'
      WHEN 'memory_book'       THEN 'book'
      WHEN 'book_read'         THEN 'book'
      WHEN 'memory_project'    THEN 'project'
      WHEN 'memory_field_trip' THEN 'field_trip'
      WHEN 'memory_activity'   THEN 'activity'
      ELSE 'photo'
    END
);
