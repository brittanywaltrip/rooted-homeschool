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
