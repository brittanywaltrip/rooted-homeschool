-- Yearbook favorites decoupling: the Favorites page used to borrow the interview
-- answers (q_favorite_book, q_loved_learning). Favorites now have their own keys
-- (content_type 'child_favorite'); copy each family's existing answers over so
-- nobody loses what they wrote. Idempotent (NOT EXISTS) and additive — it never
-- overwrites a favorite a family already set.
INSERT INTO public.yearbook_content (user_id, yearbook_key, content_type, child_id, question_key, content)
SELECT src.user_id, src.yearbook_key, 'child_favorite', src.child_id,
  CASE src.question_key WHEN 'q_favorite_book' THEN 'book' ELSE 'thing_learned' END,
  src.content
FROM public.yearbook_content src
WHERE src.content_type = 'child_interview'
  AND src.question_key IN ('q_favorite_book', 'q_loved_learning')
  AND coalesce(src.content, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.yearbook_content dst
    WHERE dst.user_id = src.user_id
      AND dst.yearbook_key = src.yearbook_key
      AND dst.content_type = 'child_favorite'
      AND dst.child_id IS NOT DISTINCT FROM src.child_id
      AND dst.question_key = CASE src.question_key WHEN 'q_favorite_book' THEN 'book' ELSE 'thing_learned' END
  );
