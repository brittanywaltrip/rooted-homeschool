// Single source of truth for the family portal reaction set.
//
// The viewer UI (components/family/FamilyFeed.tsx) and the react API allowlist
// (app/api/family/[token]/react/route.ts) MUST both use this exact list. When
// they drifted, viewers were shown 🙌 and 😍 but the API rejected them with a
// 400, and the optimistic UI made the reaction look saved when it silently was
// not. Keep it one constant so that can never happen again.
export const REACTION_EMOJIS: string[] = ["🥹", "❤️", "😂", "🙌", "😍"];
