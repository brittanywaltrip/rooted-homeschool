/* ============================================================================
 * PlanV2 child color palette.
 *
 * Policy (decision (f) in the redesign kickoff):
 *   - Existing children keep the color currently stored on their DB row.
 *   - Children added after new_plan_view ships get auto-assigned from this
 *     canonical palette by sort_order. A separate Settings affordance will
 *     let parents change the color later.
 *
 * Palette entries in order match the spec's "Emma blue, Ava amber, Zoe purple,
 * Ethan teal, Shiloh coral" naming — generic Rooted-brand-aligned colors,
 * not tied to any kid's actual name. Rotation continues past 5 for larger
 * families; at slot 7+ we wrap.
 *
 * resolveChildColor(child, idx) is the single source of truth for rendering.
 * ==========================================================================*/

export const CHILD_COLOR_PALETTE = [
  "#4a7a8a", // 0 — blue
  "#c4956a", // 1 — amber
  "#7a60a8", // 2 — purple
  "#4a9a8c", // 3 — teal
  "#d4874e", // 4 — coral
  "#8b6f47", // 5 — brown
  "#5c7f63", // 6 — Rooted brand green
] as const;

export function paletteColorFor(index: number): string {
  if (index < 0) return CHILD_COLOR_PALETTE[0];
  return CHILD_COLOR_PALETTE[index % CHILD_COLOR_PALETTE.length];
}

/** Read-only resolver. Never writes back to DB. */
export function resolveChildColor(
  child: { color: string | null } | null | undefined,
  orderedIndex: number,
): string {
  if (child?.color && child.color.trim().length > 0) return child.color;
  return paletteColorFor(orderedIndex);
}
