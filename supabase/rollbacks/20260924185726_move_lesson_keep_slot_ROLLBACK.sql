-- Rollback for 20260924185726_move_lesson_keep_slot.
--
-- Drops both functions. Safe on its own, in either order with the app:
--   - The app treats a missing function (PGRST202) as "use the old path":
--     single moves and Shift all go back to move_lesson_to_date, and
--     "I'm actually on lesson X" skips the book-order restore.
--   - Rows the functions already wrote stay as written. A held lesson
--     ('plan_hold') is an ordinary pin: completing it retires it, and a
--     Schedule Builder save that changes that curriculum's schedule releases
--     it. Nothing needs un-writing for the app to behave.
-- Rolling back the APP alone (keeping the functions) is also safe: nothing
-- calls them then.

drop function if exists public.move_lesson_keep_slot(uuid, date, date, boolean);
drop function if exists public.restore_queue_book_order(uuid, date);
