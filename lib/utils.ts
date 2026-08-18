/**
 * Capitalize the first letter of a name.
 * Handles empty/whitespace-only strings safely.
 */
export function capitalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Capitalize the `name` field on each child in an array.
 * Use as a safety net when loading children from the DB.
 */
export function capitalizeChildNames<T extends { name: string }>(children: T[]): T[] {
  return children.map(c => ({ ...c, name: capitalizeName(c.name) }));
}

/**
 * Derive the `children.name_key` value for a child's name.
 *
 * `name_key` backs the `children_user_name_unique (user_id, name_key)` partial
 * unique index (live rows only, see
 * supabase/migrations/20260818000000_children_partial_unique_indexes.sql). A
 * second index, `children_unique_per_user (user_id, lower(name))`, covers the
 * same rows by a different expression, so the two only agree while name_key
 * stays derived from the CURRENT name.
 *
 * It did not: addChild wrote name_key on insert and saveEdit never updated it,
 * so renaming a child stranded the old key. "Bob" renamed to "Robert" kept
 * name_key = "bob", and adding a real "Bob" was then refused by the key index
 * while the lower(name) index would have allowed it. 31 of 4,429 live
 * production rows carry a stale key this way, plus 6 with name_key = NULL.
 *
 * Every write of name_key must go through this function so there is one rule
 * in one place.
 */
export function childNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}
