import { supabaseAdmin } from "@/lib/supabase-admin";
import { signedPhotoUrlsAdmin } from "@/lib/photo-url";

/* ─── Shared types ──────────────────────────────────────────────────────────
   One feed shape used by the real family portal (token route), the session
   preview endpoint, and the shared <FamilyFeed /> renderer. */

export type FamilyMemory = {
  id: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string;
  child_id: string | null;
  child_name: string | null;
  child_color: string | null;
  created_at?: string;
};

export type ReactionCount = { emoji: string; count: number };

export type FamilyComment = {
  id: string;
  name: string;
  text: string;
  created_at: string;
};

export type FamilyChild = { id: string; name: string; color: string };

export type FamilyData = {
  familyName: string;
  children: FamilyChild[];
  memories: FamilyMemory[];
  reactions: Record<string, ReactionCount[]>;
  comments: Record<string, FamilyComment[]>;
  trialEnded: boolean;
  momPaid: boolean;
  trialActive?: boolean;
  trialEndsAt: string | null;
  viewerName: string | null;
};

/* Trial state is tracked per family_invite, so the caller (which knows the
   invite, or the owner's invites) decides whether the trial has ended and
   passes it in. The builder owns everything else. */
export type TrialContext = {
  trialEnded?: boolean;
  trialEndsAt?: string | null;
  viewerName?: string | null;
};

type RawMemory = {
  id: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string;
  child_id: string | null;
  created_at?: string;
};

/**
 * Assemble the family feed for a single family (owner = userId): family name,
 * children, family-visible memories with SIGNED photo URLs + child_name/color,
 * reactions, and comments. Reads only — no visit tracking, no notifications.
 *
 * Used by both the real `/api/family/[token]` route and the session-auth
 * `/api/family/preview` route so the two never drift again.
 */
export async function buildFamilyFeed(
  userId: string,
  trial: TrialContext = {}
): Promise<FamilyData> {
  const trialEndsAt = trial.trialEndsAt ?? null;
  const viewerName = trial.viewerName ?? null;

  // Mom's subscription status drives trial gating.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("display_name, first_name, is_pro, subscription_status")
    .eq("id", userId)
    .maybeSingle();

  const momPaid = profile?.is_pro === true && profile?.subscription_status === "active";
  const familyName = profile?.display_name ?? profile?.first_name ?? "Your Family";
  const trialEnded = trial.trialEnded ?? false;

  // Children (for child_name / child_color decoration + header pills).
  const { data: children } = await supabaseAdmin
    .from("children")
    .select("id, name, color")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("sort_order");

  const childMap: Record<string, { name: string; color: string }> = {};
  (children ?? []).forEach((c: FamilyChild) => {
    childMap[c.id] = { name: c.name, color: c.color };
  });

  const decorate = (raw: RawMemory[], signed: (string | null)[]): FamilyMemory[] =>
    raw.map((m, i) => ({
      ...m,
      photo_url: m.photo_url ? signed[i] : null,
      child_name: m.child_id ? childMap[m.child_id]?.name ?? null : null,
      child_color: m.child_id ? childMap[m.child_id]?.color ?? null : null,
    }));

  // Trial ended and mom hasn't paid → limited (blurred-preview) data: a few
  // memories, no reactions/comments.
  if (trialEnded && !momPaid) {
    const { data: mems } = await supabaseAdmin
      .from("memories")
      .select("id, type, title, caption, photo_url, date, child_id")
      .eq("user_id", userId)
      .eq("family_visible", true)
      .order("date", { ascending: false })
      .limit(3);

    const raw = (mems ?? []) as RawMemory[];
    const signed = await signedPhotoUrlsAdmin(
      "memory-photos",
      raw.map((m) => m.photo_url ?? ""),
      3600
    );

    return {
      familyName,
      children: children ?? [],
      memories: decorate(raw, signed),
      reactions: {},
      comments: {},
      trialEnded: true,
      momPaid: false,
      trialEndsAt,
      viewerName,
    };
  }

  // Full feed: all family-visible memories.
  const { data: mems } = await supabaseAdmin
    .from("memories")
    .select("id, type, title, caption, photo_url, date, child_id, created_at")
    .eq("user_id", userId)
    .eq("family_visible", true)
    .order("created_at", { ascending: false });

  const raw = (mems ?? []) as RawMemory[];
  const signed = await signedPhotoUrlsAdmin(
    "memory-photos",
    raw.map((m) => m.photo_url ?? ""),
    3600
  );
  const memories = decorate(raw, signed);

  // Reactions + comments for the loaded memories.
  const memIds = memories.map((m) => m.id);
  const reactions: Record<string, ReactionCount[]> = {};
  const comments: Record<string, FamilyComment[]> = {};

  if (memIds.length > 0) {
    const [{ data: rxns }, { data: cmts }] = await Promise.all([
      supabaseAdmin
        .from("memory_reactions")
        .select("memory_id, emoji, reactor_key")
        .in("memory_id", memIds),
      supabaseAdmin
        .from("memory_comments")
        .select("id, memory_id, commenter_name, body, created_at")
        .in("memory_id", memIds)
        .order("created_at", { ascending: true }),
    ]);

    // Group reactions by memory_id + emoji.
    const grouped: Record<string, Record<string, number>> = {};
    (rxns ?? []).forEach((r: { memory_id: string; emoji: string }) => {
      if (!grouped[r.memory_id]) grouped[r.memory_id] = {};
      grouped[r.memory_id][r.emoji] = (grouped[r.memory_id][r.emoji] ?? 0) + 1;
    });
    for (const [memId, types] of Object.entries(grouped)) {
      reactions[memId] = Object.entries(types)
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((a, b) => b.count - a.count);
    }

    // Group comments by memory_id.
    (cmts ?? []).forEach(
      (c: { id: string; memory_id: string; commenter_name: string; body: string; created_at: string }) => {
        if (!comments[c.memory_id]) comments[c.memory_id] = [];
        comments[c.memory_id].push({
          id: c.id,
          name: c.commenter_name,
          text: c.body,
          created_at: c.created_at,
        });
      }
    );
  }

  return {
    familyName,
    children: children ?? [],
    memories,
    reactions,
    comments,
    trialEnded: false,
    momPaid,
    trialActive: !trialEnded,
    trialEndsAt,
    viewerName,
  };
}
