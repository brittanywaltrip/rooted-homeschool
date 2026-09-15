// The weekly family digest: one email per opted-in family viewer about the
// family's new memories that week.
//
// It was complete but never scheduled. It now runs Sundays, and it runs DRY
// until the founder turns it on: FAMILY_DIGEST_MODE unset (or anything but
// "live") computes every email, sends none, and logs one line per would-be
// email with the viewer's email DOMAIN only, never the address. "live" sends.
//
// Everything with a side effect is passed in (the database client, the send
// gate, the photo signer, the sender, the logger), so node --test can run the
// whole decision with fakes. app/api/cron/family-digest/route.ts wires the real
// ones.

export type FamilyDigestMode = "dry" | "live";

/** "live" only when the flag says exactly that; everything else is a dry run. */
export function familyDigestMode(flag: string | undefined | null): FamilyDigestMode {
  return (flag ?? "").trim().toLowerCase() === "live" ? "live" : "dry";
}

/** The part of an address after the @, for logs. Never the whole address. */
export function emailDomain(email: string | null | undefined): string {
  const at = (email ?? "").lastIndexOf("@");
  return at >= 0 ? (email ?? "").slice(at + 1) || "(no domain)" : "(no domain)";
}

export interface DigestQuery extends PromiseLike<{ data?: unknown; error?: unknown }> {
  eq(column: string, value: unknown): DigestQuery;
  gte(column: string, value: unknown): DigestQuery;
  order(column: string, options: { ascending: boolean }): DigestQuery;
  limit(n: number): DigestQuery;
  maybeSingle(): PromiseLike<{ data?: unknown; error?: unknown }>;
}

export interface DigestClient {
  from(table: string): { select(columns: string): DigestQuery };
}

export interface DigestDeps {
  client: DigestClient;
  mode: FamilyDigestMode;
  canSend: (userId: string) => Promise<{ allowed: boolean; reason?: string }>;
  signPhotos: (paths: string[]) => Promise<(string | null)[]>;
  send: (args: {
    to: string;
    variables: Record<string, string>;
    headers: Record<string, string>;
  }) => Promise<{ ok: boolean; error?: string }>;
  unsubscribeHeaders: (token: string) => Record<string, string>;
  log: (line: string) => void;
  now?: Date;
}

export type DigestResult = { mode: FamilyDigestMode; wouldSend: number; sent: number; skipped: number };

type Invite = { id: string; token: string; email: string | null; viewer_name: string | null; user_id: string; trial_ends_at: string | null };
type Memory = { id: string; type: string; title: string | null; photo_url: string | null; child_id: string | null };

export async function runFamilyDigest(deps: DigestDeps): Promise<DigestResult> {
  const { client, mode, log } = deps;
  const now = deps.now ?? new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let wouldSend = 0;
  let sent = 0;
  let skipped = 0;

  // Every active, opted-in invite.
  const { data: inviteRows } = await client
    .from("family_invites")
    .select("id, token, email, viewer_name, user_id, trial_ends_at, email_opt_out")
    .eq("is_active", true)
    .eq("email_opt_out", false);
  const invites = (inviteRows ?? []) as Invite[];

  const byOwner = new Map<string, Invite[]>();
  for (const inv of invites) {
    if (!byOwner.has(inv.user_id)) byOwner.set(inv.user_id, []);
    byOwner.get(inv.user_id)!.push(inv);
  }

  for (const [userId, ownerInvites] of byOwner) {
    // Owner-side gate: don't send the digest about a family whose owner has
    // unsubscribed from marketing email. The invitees opted in via
    // family_invites.email_opt_out separately, but it's a courtesy not to
    // flood viewers with content from someone who's quitting our emails.
    const ownerGate = await deps.canSend(userId);
    if (!ownerGate.allowed) {
      skipped += ownerInvites.length;
      log(`[cron/family-digest] skipped family ${userId}: ${ownerGate.reason ?? "not allowed"}`);
      continue;
    }

    // Check if mom is paid
    const { data: profileRow } = await client
      .from("profiles")
      .select("display_name, first_name, is_pro, subscription_status")
      .eq("id", userId)
      .maybeSingle();
    const profile = profileRow as { display_name: string | null; first_name: string | null; is_pro: boolean | null; subscription_status: string | null } | null;
    const momPaid = profile?.is_pro === true && profile?.subscription_status === "active";
    const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";

    // New memories from the last 7 days
    const { data: memRows } = await client
      .from("memories")
      .select("id, type, title, photo_url, child_id, date")
      .eq("user_id", userId)
      .eq("family_visible", true)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(8);
    const newMems = (memRows ?? []) as Memory[];
    if (newMems.length === 0) continue;

    // Children for win descriptions
    const { data: childRows } = await client
      .from("children")
      .select("id, name")
      .eq("user_id", userId)
      .eq("archived", false);
    const childMap: Record<string, string> = {};
    for (const c of (childRows ?? []) as { id: string; name: string }[]) childMap[c.id] = c.name;

    const wins = newMems
      .filter((m) => m.type === "win" || m.type === "book")
      .slice(0, 4)
      .map((m) => {
        const childName = m.child_id ? childMap[m.child_id] : null;
        return childName ? `${childName}: ${m.title ?? m.type}` : (m.title ?? m.type);
      });

    // Up to 4 photo thumbnails, each signed for 7 days so recipients can see
    // them when they open the email days later; a photo that fails to sign is
    // dropped rather than rendered broken.
    const photoPaths = newMems.filter((m) => !!m.photo_url).slice(0, 4).map((m) => m.photo_url as string);
    const renderablePhotos = photoPaths.length > 0
      ? (await deps.signPhotos(photoPaths)).filter((u): u is string => !!u)
      : [];

    for (const inv of ownerInvites) {
      // Trial must be active OR mom paid
      const trialEnded = inv.trial_ends_at && new Date(inv.trial_ends_at) < now;
      if (trialEnded && !momPaid) continue;
      if (!inv.email) continue;

      wouldSend++;
      if (mode === "dry") {
        log(`[cron/family-digest] DRY would send to ${emailDomain(inv.email)} for family ${userId}: ${newMems.length} memories`);
        continue;
      }

      const viewUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}`;
      const unsubscribeUrl = `https://www.rootedhomeschoolapp.com/family/${inv.token}/unsubscribe`;
      const photoGridHtml = renderablePhotos.length > 0
        ? renderablePhotos.map((url) =>
          `<img src="${url}" alt="" style="width:48%;height:140px;object-fit:cover;border-radius:8px;display:inline-block;margin:2px;" />`
        ).join("")
        : "";
      const highlightsHtml = wins.length > 0
        ? `<p style="font-weight:600;margin:16px 0 8px;">Highlights:</p>` +
          wins.map((w) => `<p style="color:#7a6f65;margin:0 0 4px;">• ${w}</p>`).join("")
        : "";

      try {
        const result = await deps.send({
          to: inv.email,
          variables: {
            recipientName: inv.viewer_name ?? "Friend",
            familyName,
            memoryCount: String(newMems.length),
            photoGrid: photoGridHtml,
            highlights: highlightsHtml,
            familyUrl: viewUrl,
            unsubscribeUrl,
          },
          headers: deps.unsubscribeHeaders(inv.token),
        });
        if (result.ok) sent++;
        else log(`[cron/family-digest] send failed to ${emailDomain(inv.email)} for family ${userId}: ${result.error ?? "unknown"}`);
      } catch (err) {
        log(`[cron/family-digest] send threw for ${emailDomain(inv.email)} for family ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  log(`[cron/family-digest] ${mode === "dry" ? "DRY " : ""}summary: mode=${mode} wouldSend=${wouldSend} sent=${sent} skipped=${skipped}`);
  return { mode, wouldSend, sent, skipped };
}
