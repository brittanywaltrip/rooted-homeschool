/**
 * The parent Garden's growth ladder, shared by the Garden and the Years page.
 *
 * It lived inside app/dashboard/garden/page.tsx, which a Next.js page cannot
 * export from, and the Years page now draws last year's finished trees with
 * the same emoji and the same label. One table, so the two cannot drift.
 */

// Every emoji in this table is Emoji 1.0 (2015) on purpose. 🫘 (Seed) and
// 🪴 (Seedling) were Emoji 14.0 and 13.0, which Windows 10 and older macOS
// system fonts do not carry, so both stages rendered as a blank box on a
// desktop while the same family's iPhone showed them. A mother's first look
// at her garden is the Seed stage, and hers was empty.
// Guard: lib/garden-stage-emoji.test.ts.
export const GROWTH_STAGES = [
  { name: "Seed",          emoji: "🌰", label: "Just getting started",       min: 0,   scale: 1.0 },
  { name: "Sprouting",     emoji: "🌱", label: "A tiny shoot appears",       min: 1,   scale: 1.0 },
  { name: "Seedling",      emoji: "🍃", label: "Putting down roots",         min: 10,  scale: 1.0 },
  { name: "Growing",       emoji: "🌿", label: "Putting down roots",         min: 25,  scale: 0.8 },
  { name: "Young Tree",    emoji: "🌳", label: "Standing tall",              min: 50,  scale: 1.0 },
  { name: "Flourishing",   emoji: "🌲", label: "Strong and steady",          min: 100, scale: 1.1 },
  { name: "Blossoming",    emoji: "🌸", label: "In full bloom",              min: 200, scale: 1.2 },
  { name: "Bearing Fruit", emoji: "🍎", label: "The harvest of your work",   min: 500, scale: 1.4 },
];

export type GrowthStage = (typeof GROWTH_STAGES)[number];

export function getGrowthStageIndex(leaves: number): number {
  let idx = 0;
  for (let i = 0; i < GROWTH_STAGES.length; i++) {
    if (leaves >= GROWTH_STAGES[i].min) idx = i;
  }
  return idx;
}

export function getGrowthStage(leaves: number): GrowthStage {
  return GROWTH_STAGES[getGrowthStageIndex(leaves)];
}
