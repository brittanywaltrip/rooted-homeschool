"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Sun, Leaf, Camera, Calendar, Search, Menu, X, Printer, GraduationCap, FileText } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  getUserWithRetry,
  reportAuthRedirect,
  reportAuthCheckUnavailable,
} from "@/lib/auth-retry";
import { PartnerContext, PartnerContextType } from "@/lib/partner-context";
import UpgradeBanner from "@/app/components/UpgradeBanner";
import { ProfileProvider, useProfile } from "@/lib/profile-context";
import { BadgeNotificationListener } from "@/components/BadgeNotification";
import { checkAndAwardBadges } from "@/lib/badges";
import { onLogAction } from "@/app/lib/onLogAction";
import { uploadMemoryPhoto, PhotoReadError } from "@/lib/photo-pipeline";
import { getRemainingPhotoSlots } from "@/app/lib/integrity-checks";
import { captureSupabaseError } from "@/lib/sentry-error";
import SignedImage from "@/components/SignedImage";
import { DashboardLayoutProvider, useDashboardLayout } from "@/lib/dashboard-layout-context";
import { capitalizeChildNames } from "@/lib/utils";
import { LeafAnimationProvider, useLeafAnimationContext } from "@/app/contexts/LeafAnimationContext";
import { getUserAccess } from "@/lib/user-access";
import { posthog } from "@/lib/posthog";

const navItems = [
  { label: "Today",     href: "/dashboard",           icon: Sun      },
  { label: "Plan",      href: "/dashboard/plan",      icon: Calendar },
  { label: "Garden",    href: "/dashboard/garden",    icon: Leaf     },
  { label: "Memories",    href: "/dashboard/memories",    icon: Camera   },
  { label: "Printables",  href: "/dashboard/printables",  icon: Printer  },
  { label: "Reports",     href: "/dashboard/reports",     icon: FileText },
  { label: "Transcripts", href: "/dashboard/transcript",  icon: GraduationCap },
  { label: "Resources",   href: "/dashboard/resources",   icon: Search   },
];

/* NAV ORDER — Today → Plan → Garden → Memories → Printables → More */
const mobileBottomNav = [
  { label: "Today",       href: "/dashboard",              icon: Sun      },
  { label: "Plan",        href: "/dashboard/plan",         icon: Calendar },
  { label: "Garden",      href: "/dashboard/garden",       icon: Leaf     },
  { label: "Memories",    href: "/dashboard/memories",     icon: Camera   },
  { label: "Printables",  href: "/dashboard/printables",   icon: Printer  },
  { label: "More",        href: "/dashboard/more",         icon: Menu     },
];

function NavLink({
  label, href, icon: Icon, active, onClick, badge,
}: {
  label: string; href: string; icon: React.ElementType;
  active: boolean; onClick?: () => void; badge?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active
          ? "text-[var(--g-deep)]"
          : "text-[#7a6f65] hover:bg-[#f0ede8] hover:text-[#2d2926]"
      }`}
    >
      <div className="relative">
        <Icon size={17} strokeWidth={active ? 2.5 : 1.8} />
        {badge && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#c4956a] border border-[#fefcf9]" />
        )}
      </div>
      {label}
    </Link>
  );
}

/**
 * Was this signed-in account previously deleted?
 *
 * deleted_accounts is service-role only and deliberately unreadable by anon
 * and authenticated (see lib/deleted-account.ts), so the browser cannot query
 * it directly and must not be handed the service key. /api/account/deleted-status
 * already exposes exactly this, service-role side, for /welcome-back; this
 * reuses it rather than adding a second route that answers the same question.
 *
 * Never throws and never blocks the gate. A failed lookup returns false, which
 * falls through to the pre-existing onboarding path, which is the bug being
 * fixed, not a locked-out family. Same rule findDeletedAccount applies on the server.
 */
async function wasAccountDeleted(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
): Promise<boolean> {
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return false;
    const res = await fetch("/api/account/deleted-status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { wasDeleted?: boolean; hasProfile?: boolean };
    // hasProfile guards the "start fresh" case: once that POST has written a
    // profile row the family belongs in onboarding, not back on the
    // explanation page. Without it they could not get out.
    return Boolean(body.wasDeleted) && !body.hasProfile;
  } catch {
    return false;
  }
}

function nameInitial(name: string): string {
  const stripped = name.replace(/^the\s+/i, "").replace(/\s+family$/i, "").trim();
  return stripped ? stripped.charAt(0).toUpperCase() : "🌿";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <LeafAnimationProvider>
        <DashboardLayoutProvider>
          <DashboardLayoutInner>{children}</DashboardLayoutInner>
        </DashboardLayoutProvider>
      </LeafAnimationProvider>
    </ProfileProvider>
  );
}

type FabChild = { id: string; name: string; color: string | null };

/** Photos per batch from the FAB. Enough for a morning, small enough to upload
 *  one at a time on a phone without the sheet feeling stuck. */
const MAX_FAB_PHOTOS = 10;

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { displayName: profileName, familyPhotoUrl: ctxPhotoUrl } = useProfile();
  const { hideFab } = useDashboardLayout();
  const [checking,  setChecking]  = useState(true);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [profileData, setProfileData] = useState<{ first_name?: string | null; family_photo_url?: string | null }>({});
  const [isPro, setIsPro] = useState(false);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);

  // ── Floating camera FAB state ────────────────────────────────────────────
  // Two file inputs, not one: the `capture` attribute suppresses multi-select,
  // so the camera input and the gallery input cannot be the same element.
  const fabFileRef = useRef<HTMLInputElement>(null);
  const fabCameraRef = useRef<HTMLInputElement>(null);
  const fabToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fabKids, setFabKids] = useState<FabChild[]>([]);
  const [fabFiles, setFabFiles] = useState<File[]>([]);
  const [fabUrls, setFabUrls] = useState<string[]>([]);
  const [fabCaption, setFabCaption] = useState("");
  const [fabChildId, setFabChildId] = useState("");
  const [fabSaving, setFabSaving] = useState(false);
  const [fabProgress, setFabProgress] = useState<{ current: number; total: number } | null>(null);
  const [fabLimitHit, setFabLimitHit] = useState(false);
  // Partial-batch outcome ("Saved 3 of 5..."), shown IN the sheet, which stays
  // open holding the photos that failed.
  const [fabNote, setFabNote] = useState<string | null>(null);
  const [fabRemaining, setFabRemaining] = useState<number | null>(null);
  const [fabActionSheet, setFabActionSheet] = useState(false);
  const [fabToast, setFabToast] = useState<string | null>(null);
  const [leafBurst, setLeafBurst] = useState(false);
  const { earnLeaf } = useLeafAnimationContext();
  const [unreadFamilyNotifs, setUnreadFamilyNotifs] = useState(0);

  const [partnerCtx,  setPartnerCtx]  = useState<PartnerContextType>({
    isPartner: false,
    effectiveUserId: "",
    ownerName: "",
  });

  useEffect(() => {
    let mounted = true;

    // getUser() reaches Supabase's auth server with whichever session it can
    // find (cookie or localStorage). Middleware refreshes the cookie on every
    // request, so it succeeds whenever the cookie is valid, even with nothing
    // in localStorage. Keep using it: INITIAL_SESSION was unreliable in that
    // case and left the layout stuck on the loading skeleton.
    //
    // But it is a NETWORK call, and that is what this handling is about. A
    // phone waking with weak signal gets { user: null, error:
    // AuthRetryableFetchError } while the session is still perfectly valid.
    // The old code destructured the error away and redirected, which put three
    // families back on the login form typing a password they did not need to
    // type. getUserWithRetry retries transport failures and only reports
    // "signed-out" when the auth server actually answered.
    void (async () => {
      const auth = await getUserWithRetry(supabase);
      if (!mounted) return;

      if (auth.kind === "signed-out") {
        reportAuthRedirect("dashboard-layout", auth.reason);
        router.replace("/login");
        return;
      }

      let user = auth.kind === "ok" ? auth.user : null;
      if (!user) {
        // The check never completed, so we know nothing about the session and
        // must NOT redirect. Try the cookie locally for the user id: it costs
        // no network call, and auth cookies are deliberately not httpOnly (see
        // app/api/auth/login/route.ts) so the browser client can read them.
        // Recovering the id here is the difference between a dashboard that
        // loads once the connection returns and an empty shell.
        reportAuthCheckUnavailable(
          "dashboard-layout",
          auth.kind === "unavailable" ? auth.reason : "no-user",
        );
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!mounted) return;
          user = sessionData?.session?.user ?? null;
        } catch {
          user = null;
        }
        if (!user) {
          // No id to work with. Render anyway rather than redirect; the page's
          // own loading states take it from here, and a real sign-out still
          // arrives on the SIGNED_OUT subscription below.
          setChecking(false);
          return;
        }
      }

      const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];
      if (ADMIN_EMAILS.includes(user.email ?? "")) {
        setIsAdmin(true);
      }

      // Load family name + subscription status.
      //
      // The error is NOT discarded any more. A transient read failure returns
      // { data: null, error }, which the old code read as "no profile" and
      // used to route an established family into the new-family wizard. One
      // retry, then stay put: a missing profile is only believable when the
      // read actually succeeded.
      const PROFILE_COLUMNS =
        "display_name, subscription_status, family_photo_url, first_name, onboarded, is_pro, trial_started_at";
      let { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", user.id)
        .maybeSingle();
      if (profileErr) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!mounted) return;
        ({ data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select(PROFILE_COLUMNS)
          .eq("id", user.id)
          .maybeSingle());
      }

      if (!mounted) return;

      if (profileErr) {
        // Could not read the profile. Do not guess: routing to /onboarding on
        // a failed read restarts an established family's setup.
        reportAuthCheckUnavailable("dashboard-layout-profile", "profile-read-failed", {
          message: (profileErr as { message?: string }).message ?? null,
        });
        setPartnerCtx({ isPartner: false, effectiveUserId: user.id, ownerName: "" });
        setChecking(false);
        return;
      }

      // Gate: send new (no profile yet) or non-onboarded users through the wizard
      // onboarded is NULL for new users (not false), so check !== true
      // Reached only when the read succeeded, so "no profile" is a real fact.
      if (!profile || (profile as { onboarded?: boolean | null } | null)?.onboarded !== true) {
        // No profile row usually means "new family". It also means "this
        // account was deleted but its auth.users row survived the wipe" (see
        // lib/deleted-account.ts), and handing THAT family the new-family
        // wizard silently restarts them: fresh trial, no word about the year
        // of memories that is gone. app/api/auth/login/route.ts and
        // app/auth/callback/route.ts already separate the two cases; this
        // gate did not, so any other way into /dashboard (live session,
        // bookmark, PWA icon, email link) walked straight past it.
        //
        // Only runs when there is genuinely no profile row. Families with a
        // profile, meaning everyone who is fine, reach the code below without
        // an extra request.
        if (!profile) {
          const deleted = await wasAccountDeleted(supabase);
          if (!mounted) return;
          if (deleted) {
            router.replace("/welcome-back");
            return;
          }
        }
        router.replace("/onboarding");
        return;
      }

      // ── Partner detection ──────────────────────────────────────────────────
      // The owner/admin account is never a partner view — skip the check entirely.
      if (user.email === "garfieldbrittany@gmail.com") {
        sessionStorage.removeItem("rooted_partner");
        setPartnerCtx({ isPartner: false, effectiveUserId: user.id, ownerName: "" });
        if (profile) setProfileData({ first_name: (profile as any).first_name, family_photo_url: (profile as any).family_photo_url });
        setIsPro((profile as any).is_pro ?? false);
        setTrialStartedAt((profile as any).trial_started_at ?? null);
        setChecking(false);
        return;
      }

      // Check sessionStorage cache first (avoids extra DB call on nav)
      const cached = sessionStorage.getItem("rooted_partner");
      if (cached) {
        const parsed: PartnerContextType = JSON.parse(cached);
        setPartnerCtx(parsed);
        setChecking(false);
        return;
      }

      // Check if this user's email appears as partner_email in any profile.
      // Requires: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_email text;
      const email = user.email;
      if (email) {
        const { data: ownerProfile, error: partnerErr } = await supabase
          .from("profiles")
          .select("id, display_name")
          .eq("partner_email", email)
          .maybeSingle();

        if (!mounted) return;

        if (!partnerErr && ownerProfile) {
          const ctx: PartnerContextType = {
            isPartner: true,
            effectiveUserId: ownerProfile.id,
            ownerName: ownerProfile.display_name || "",
          };
          sessionStorage.setItem("rooted_partner", JSON.stringify(ctx));
          setPartnerCtx(ctx);
          setChecking(false);
          return;
        }
      }

      // Normal user
      setPartnerCtx({
        isPartner: false,
        effectiveUserId: user.id,
        ownerName: "",
      });
      if (profile) setProfileData({ first_name: (profile as any).first_name, family_photo_url: (profile as any).family_photo_url });
      setIsPro((profile as any).is_pro ?? false);
      setTrialStartedAt((profile as any).trial_started_at ?? null);

      // Check for unread family notifications
      const { count } = await supabase
        .from("family_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null);

      if (!mounted) return;
      setUnreadFamilyNotifs(count ?? 0);

      setChecking(false);
    })();

    // Keep the auth-state subscription for cross-tab sign-outs and to absorb
    // middleware-driven token refreshes. The initial auth check above is
    // handled by getUser(), so INITIAL_SESSION/SIGNED_IN are intentionally
    // not handled here.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        reportAuthRedirect("dashboard-layout", "SIGNED_OUT-event");
        router.replace("/login");
        return;
      }
      // TOKEN_REFRESHED: middleware already wrote the new cookies and the
      // browser client now has the new session in memory. No action needed.
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  // Prefer context photo (updates after settings save) over one-time local fetch
  const avatarPhotoUrl = ctxPhotoUrl ?? profileData.family_photo_url ?? null;

  async function handleSignOut() {
    sessionStorage.removeItem("rooted_partner");
    await supabase.auth.signOut();
    // Clear the PostHog identity so the next user who signs in on this same
    // browser starts a fresh analytics identity instead of inheriting the
    // previous user's distinct_id.
    posthog.reset();
    router.replace("/login");
  }

  function isActive(href: string) {
    return href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);
  }

  // ── FAB: load children for child pills ─────────────────────────────────────
  const loadFabKids = useCallback(async () => {
    if (!partnerCtx.effectiveUserId || partnerCtx.isPartner) return;
    const { data } = await supabase
      .from("children").select("id, name, color")
      .eq("user_id", partnerCtx.effectiveUserId).eq("archived", false).order("sort_order");
    setFabKids(capitalizeChildNames((data as FabChild[]) ?? []));
  }, [partnerCtx.effectiveUserId, partnerCtx.isPartner]);
  useEffect(() => { if (!checking) loadFabKids(); }, [checking, loadFabKids]);

  // Re-fetch FAB kids when children are added/edited/removed in Settings
  useEffect(() => {
    const handler = () => loadFabKids();
    window.addEventListener("rooted:children-updated", handler);
    return () => window.removeEventListener("rooted:children-updated", handler);
  }, [loadFabKids]);

  // The FAB now opens a chooser (camera or gallery) instead of jumping straight
  // to the gallery picker.
  function openFabPicker() { setFabActionSheet(true); }

  // Listen for cross-page FAB open requests (e.g. from memories grid camera icon)
  useEffect(() => {
    const handler = () => openFabPicker();
    window.addEventListener("rooted:open-fab", handler);
    return () => window.removeEventListener("rooted:open-fab", handler);
  });

  // One toast at a time. Photo-read errors are full sentences and need longer
  // than the 3s a "Memory saved" confirmation gets.
  function showFabToast(message: string, ms = 3000) {
    if (fabToastTimer.current) clearTimeout(fabToastTimer.current);
    setFabToast(message);
    fabToastTimer.current = setTimeout(() => setFabToast(null), ms);
  }

  async function onFabFilesChosen(files: File[]) {
    if (files.length === 0) return;
    setFabLimitHit(false);

    let picked = files.slice(0, MAX_FAB_PHOTOS);
    if (files.length > MAX_FAB_PHOTOS) {
      showFabToast(`Only the first ${MAX_FAB_PHOTOS} photos were added.`, 4000);
    }

    // Free families are capped, so trim the batch to what is actually left and
    // say so in the sheet. When nothing is left the selection is kept as-is:
    // the sheet still has to open, otherwise the button looks dead again and
    // the upgrade path is never shown.
    //
    // The whole count is wrapped because it is the only part that can reject,
    // and it is a courtesy, not the gate. getPhotoCount runs two queries under
    // Promise.all, so one of them failing used to reject this entire
    // fire-and-forget handler: setFabFiles never ran, the sheet never opened,
    // nothing was said, and the input value had already been cleared so
    // re-picking the same photos did nothing at all. That is the dead-button
    // symptom this branch exists to remove. On failure the sheet opens anyway
    // with remaining unknown, and the save-time gate is the authority.
    let remaining: number | null = null;
    try {
      if (getUserAccess({ is_pro: isPro, trial_started_at: trialStartedAt }) === "free") {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          remaining = await getRemainingPhotoSlots(user.id, true);
          if (remaining > 0 && picked.length > remaining) picked = picked.slice(0, remaining);
        }
      }
    } catch (err) {
      captureSupabaseError("fab photo count", err);
      remaining = null;
    }

    setFabNote(null);
    setFabRemaining(remaining);
    setFabFiles(picked);
    setFabUrls(picked.map((f) => URL.createObjectURL(f)));
    setFabCaption("");
    setFabChildId("");
  }

  function removeFabPhoto(index: number) {
    const url = fabUrls[index];
    if (url) URL.revokeObjectURL(url);
    const nextUrls = fabUrls.filter((_, i) => i !== index);
    setFabFiles(fabFiles.filter((_, i) => i !== index));
    setFabUrls(nextUrls);
    if (nextUrls.length === 0) closeFabSheet();
  }

  function closeFabSheet() {
    fabUrls.forEach((u) => URL.revokeObjectURL(u));
    setFabFiles([]); setFabUrls([]); setFabCaption(""); setFabChildId("");
    setFabLimitHit(false); setFabRemaining(null); setFabProgress(null);
    setFabNote(null);
  }
  async function saveFabPhoto() {
    if (fabFiles.length === 0 || fabSaving) return;

    // The spinner starts BEFORE the gate. The auth and count round trips used
    // to run ahead of it, so a family tapping Save watched an unchanged button
    // for the whole window and assumed it was broken.
    setFabSaving(true);
    setFabLimitHit(false);
    setFabNote(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Photo limit gate. getRemainingPhotoSlots is the one definition of how
      // many photos a family has, shared with the other capture paths.
      const accessLevel = getUserAccess({ is_pro: isPro, trial_started_at: trialStartedAt });
      const remaining = await getRemainingPhotoSlots(user.id, accessLevel === "free");
      if (remaining <= 0) {
        // The sheet renders the cap notice + upgrade link. The event is for
        // the Today page, which listens for it; every OTHER page had none,
        // which is why this used to fail in total silence.
        setFabRemaining(0);
        setFabLimitHit(true);
        window.dispatchEvent(new CustomEvent("rooted:photo-limit-reached"));
        return;
      }

      const batch = fabFiles.slice(0, Math.min(fabFiles.length, remaining));
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      let saved = 0;
      // Which entries of fabFiles actually landed. batch is a prefix slice of
      // fabFiles, so these indices line up with both fabFiles and fabUrls.
      const savedIdx = new Set<number>();
      let firstFailure: { message: string; long: boolean } | null = null;

      // Sequential on purpose. Parallel uploads from a phone on cellular is how
      // you get stalls, and a partial failure stays legible this way.
      for (let i = 0; i < batch.length; i++) {
        setFabProgress({ current: i + 1, total: batch.length });
        try {
          const { photoUrl, width, height } = await uploadMemoryPhoto(supabase, user.id, batch[i]);
          const { error: insErr } = await supabase.from("memories").insert({
            user_id: user.id,
            type: "photo",
            // The sheet's text field goes to `caption`, not `title`. It is
            // labelled Caption and promises to print under the photo, and the
            // yearbook's caption line reads memories.caption; text left in
            // `title` never appeared under a collage photo at all, so this
            // path quietly made a different promise from the Today capture.
            caption: fabCaption.trim() || null,
            photo_url: photoUrl,
            photo_width: width,
            photo_height: height,
            child_id: fabChildId || null,
            date: today,
            // include_in_book: true. Photos are IN the book by default,
            // matching the column default and the way the yearbook editor is
            // worded: it offers a Hide toggle, which only makes sense if
            // things start included. The reader filters on
            // .eq("include_in_book", true), so false here meant every photo
            // taken with the Quick photo button, the most convenient capture
            // in the app, never reached a page. The way out is the editor's
            // Hide toggle, not the capture path.
            include_in_book: true,
          });
          if (insErr) throw insErr;
          saved++;
          savedIdx.add(i);
        } catch (err) {
          captureSupabaseError("fab photo save", err);
          if (!firstFailure) {
            firstFailure = err instanceof PhotoReadError
              ? { message: err.userMessage, long: true }
              : { message: "Upload failed, check your connection and try again", long: false };
          }
        }
      }

      if (saved === 0) {
        // Nothing landed, so leave the sheet open: the family can retry or drop
        // the photo that failed without picking everything again.
        const failure = firstFailure ?? { message: "Upload failed, check your connection and try again", long: false };
        showFabToast(failure.message, failure.long ? 6000 : 3000);
        return;
      }

      // Anything that did NOT save stays selected. Closing the sheet on a
      // partial batch revoked every URL including the failures, leaving the
      // family to find that one photo again in a camera roll of hundreds with
      // no idea which it was.
      const keptFiles = fabFiles.filter((_, i) => !savedIdx.has(i));
      const keptUrls = fabUrls.filter((_, i) => !savedIdx.has(i));
      const pickedCount = fabFiles.length;

      if (keptFiles.length === 0) {
        closeFabSheet();
      } else {
        // Revoke ONLY the ones that saved; the kept URLs still back previews.
        fabUrls.forEach((u, i) => { if (savedIdx.has(i)) URL.revokeObjectURL(u); });
        setFabFiles(keptFiles);
        setFabUrls(keptUrls);
        setFabNote(`Saved ${saved} of ${pickedCount}. ${firstFailure?.message ?? ""}`.trim());
      }

      // One leaf, one event, one badge check per batch, not per photo.
      window.dispatchEvent(new CustomEvent("rooted:memory-saved", { detail: { type: "photo" } }));
      setLeafBurst(true); setTimeout(() => setLeafBurst(false), 1200);
      earnLeaf();
      if (keptFiles.length === 0) {
        showFabToast(saved > 1 ? `${saved} memories saved 🌿` : "Memory saved 🌿", 2000);
      }
      checkAndAwardBadges(user.id);
      onLogAction({ userId: user.id, childId: fabChildId || undefined, actionType: "memory" });
    } catch (err) {
      captureSupabaseError("fab photo save", err);
      if (err instanceof PhotoReadError) {
        showFabToast(err.userMessage, 6000);
      } else {
        showFabToast("Upload failed, check your connection and try again", 3000);
      }
    } finally {
      setFabSaving(false);
      setFabProgress(null);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex">
        {/* Skeleton sidebar */}
        <aside className="hidden md:flex flex-col w-52 bg-[#fefcf9] border-r border-[#e8e2d9] fixed top-0 left-0 h-full z-40">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-[#e8e2d9] flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#e8e2d9] animate-pulse shrink-0" />
            <div className="space-y-1.5">
              <div className="w-16 h-3 rounded bg-[#e8e2d9] animate-pulse" />
              <div className="w-10 h-2 rounded bg-[#e8e2d9] animate-pulse" />
            </div>
          </div>
          {/* Avatar */}
          <div className="px-4 py-3 border-b border-[#f0ede8] flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#e8e2d9] animate-pulse shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="w-20 h-2.5 rounded bg-[#e8e2d9] animate-pulse" />
              <div className="w-14 h-2 rounded bg-[#e8e2d9] animate-pulse" />
            </div>
          </div>
          {/* Nav items */}
          <div className="p-3 space-y-1.5 flex-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-4 h-4 rounded bg-[#e8e2d9] animate-pulse shrink-0" />
                <div className="h-3 rounded bg-[#e8e2d9] animate-pulse" style={{ width: `${50 + (i % 3) * 18}%` }} />
              </div>
            ))}
          </div>
          {/* Bottom */}
          <div className="p-3 border-t border-[#e8e2d9] space-y-1.5">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="w-4 h-4 rounded bg-[#e8e2d9] animate-pulse shrink-0" />
              <div className="w-16 h-3 rounded bg-[#e8e2d9] animate-pulse" />
            </div>
          </div>
        </aside>

        {/* Skeleton main content */}
        <main className="flex-1 min-w-0 overflow-x-hidden md:ml-52 flex flex-col min-h-screen">
          {/* Mobile top bar skeleton */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9]">
            <div className="w-16 h-4 rounded bg-[#e8e2d9] animate-pulse" />
            <div className="w-6 h-6 rounded bg-[#e8e2d9] animate-pulse" />
          </div>
          <div className="max-w-2xl px-5 py-7 space-y-6 w-full">
            {/* Greeting */}
            <div className="space-y-2">
              <div className="w-32 h-3 rounded bg-[#e8e2d9] animate-pulse" />
              <div className="w-56 h-6 rounded bg-[#e8e2d9] animate-pulse" />
            </div>
            {/* Quote card */}
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 space-y-2">
              <div className="w-24 h-2.5 rounded bg-[#e8e2d9] animate-pulse" />
              <div className="w-full h-3 rounded bg-[#e8e2d9] animate-pulse" />
              <div className="w-3/4 h-3 rounded bg-[#e8e2d9] animate-pulse" />
            </div>
            {/* Lessons section */}
            <div className="space-y-3">
              <div className="w-28 h-3 rounded bg-[#e8e2d9] animate-pulse" />
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-5 h-5 rounded-md bg-[#e8e2d9] animate-pulse shrink-0" />
                    <div className="h-3 rounded bg-[#e8e2d9] animate-pulse flex-1" style={{ width: `${55 + (i % 3) * 15}%` }} />
                    <div className="w-10 h-2.5 rounded bg-[#e8e2d9] animate-pulse shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const displayName = partnerCtx.isPartner
    ? partnerCtx.ownerName
    : (profileName || "");

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[#e8e2d9] flex items-center justify-between">
        <Link
          href="/dashboard"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-2.5"
        >
          <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: '36px', width: 'auto' }} />
        </Link>
        <Link
          href="/dashboard/settings"
          onClick={() => setMenuOpen(false)}
          className="w-10 h-10 rounded-full bg-[#e8f0e9] flex items-center justify-center text-sm font-bold text-[var(--g-deep)] hover:bg-[#d4e8d4] transition-colors shrink-0 overflow-hidden"
        >
          {avatarPhotoUrl ? (
            <SignedImage src={avatarPhotoUrl} bucket="family-photos" alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : profileData.first_name ? (
            nameInitial(profileData.first_name)
          ) : displayName ? (
            nameInitial(displayName)
          ) : '🌿'}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ label, href, icon }) => (
          <NavLink
            key={href}
            label={label}
            href={href}
            icon={icon}
            active={isActive(href)}
            onClick={() => setMenuOpen(false)}
            badge={label === "Memories" && unreadFamilyNotifs > 0}
          />
        ))}
      </nav>

      {/* Settings + Sign out */}
      <div className="p-3 border-t border-[#e8e2d9] space-y-0.5">
        {isAdmin && (
          <Link
            href="/admin"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] hover:text-[#2d2926] transition-colors"
          >
            <span className="text-[15px]">🔒</span>
            Admin
          </Link>
        )}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#7a6f65] hover:bg-red-50 hover:text-red-600 w-full transition-colors"
        >
          <div className="w-4 h-4 rounded-full bg-[#e8f0e9] flex items-center justify-center shrink-0 text-[9px] font-bold text-[#5c7f63]">
            {nameInitial(displayName)}
          </div>
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <PartnerContext.Provider value={partnerCtx}>
      <div className="min-h-screen bg-[#f8f7f4] flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex flex-col w-52 bg-[#fefcf9] border-r border-[#e8e2d9] fixed top-0 left-0 h-full z-40">
          {sidebarContent}
        </aside>

        {/* Mobile backdrop */}
        {menuOpen && (
          <div
            className="fixed inset-0 bg-black/25 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
        )}

        {/* Mobile drawer */}
        <aside
          className={`fixed top-0 left-0 h-full w-52 bg-[#fefcf9] border-r border-[#e8e2d9] z-50 flex flex-col transition-transform duration-200 md:hidden ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {sidebarContent}
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-x-hidden md:ml-52 flex flex-col min-h-screen">
          <UpgradeBanner />
        {/* Mobile top bar — brand + avatar */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9] sticky top-0 z-30">
            <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: '32px', width: 'auto' }} />
            <Link
              href="/dashboard/settings"
              className="w-10 h-10 rounded-full bg-[#e8f0e9] flex items-center justify-center text-sm font-bold text-[var(--g-deep)] hover:bg-[#d4e8d4] transition-colors shrink-0 overflow-hidden"
            >
              {avatarPhotoUrl ? (
                <SignedImage src={avatarPhotoUrl} bucket="family-photos" alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : profileData.first_name ? (
                nameInitial(profileData.first_name)
              ) : displayName ? (
                nameInitial(displayName)
              ) : '🌿'}
            </Link>
          </div>

          {/* Partner banner */}
          {partnerCtx.isPartner && (
            <div className="bg-[#e8f5ea] border-b border-[#b8d9bc] px-4 py-2.5 flex items-center gap-2">
              <span className="text-sm">👀</span>
              <p className="text-xs font-medium text-[var(--g-deep)]">
                Viewing{partnerCtx.ownerName ? ` ${partnerCtx.ownerName}'s` : ""} family dashboard as a partner
                <span className="ml-2 text-[#5c7f63] opacity-80">· read-only</span>
              </p>
            </div>
          )}

          <div className="flex-1 pb-28 md:pb-0">{children}</div>
        </main>

        {/* Mobile bottom nav bar — 5 tabs */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#fefcf9] border-t border-[#e8e2d9] flex items-stretch" style={{ minHeight: "3.75rem", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {mobileBottomNav.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            const showBadge = label === "Memories" && unreadFamilyNotifs > 0;
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition-colors ${
                  active ? "text-[#2D5A3D]" : "text-[#c8bfb5]"
                }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                  {showBadge && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#c4956a] border border-[#fefcf9]" />
                  )}
                </div>
                {label}
                {active && <span className="w-1 h-1 rounded-full bg-[#2D5A3D] -mt-0.5" />}
              </Link>
            );
          })}
        </nav>


        {/* ── Floating Camera FAB ────────────────────────────────── */}
        {!partnerCtx.isPartner && fabUrls.length === 0 && !fabActionSheet && !hideFab && (
          <button onClick={openFabPicker}
            className="fixed bottom-28 right-4 md:bottom-6 md:right-6 z-50 w-14 h-16 rounded-full flex flex-col items-center justify-center gap-0.5 shadow-lg active:scale-90 transition-all hover:shadow-xl"
            style={{ backgroundColor: "var(--g-brand)" }} aria-label="Quick photo" data-fab-trigger>
            <Camera size={20} className="text-white" strokeWidth={2.2} />
            <span className="text-white leading-none" style={{ fontSize: 9 }}>Quick photo</span>
          </button>
        )}
        {/* NOTE: app/components/LessonPhotoButton.tsx now mirrors this pattern —
            an app-rendered action sheet over two hidden inputs (one gallery, one
            `capture`). Any future capture change here should land there too, so
            the two sheets keep feeling like one app. */}
        {/* Gallery picker: multi-select. Never give this one `capture`, which
            would silently reduce it to a single photo. */}
        <input ref={fabFileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (e.target) e.target.value = "";
            if (files.length) void onFabFilesChosen(files);
          }} />
        {/* Camera: single shot, straight to the rear camera. */}
        <input ref={fabCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (e.target) e.target.value = "";
            if (files.length) void onFabFilesChosen(files);
          }} />

        {/* ── FAB action sheet: camera or gallery ─────────────────── */}
        {fabActionSheet && (
          <>
            <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" onClick={() => setFabActionSheet(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
              <div className="px-5 pb-5 space-y-2.5">
                <button onClick={() => { setFabActionSheet(false); fabCameraRef.current?.click(); }}
                  className="w-full py-3 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                  style={{ backgroundColor: "var(--g-brand)" }}>
                  <Camera size={16} strokeWidth={2.2} />
                  Take a photo
                </button>
                <button onClick={() => { setFabActionSheet(false); fabFileRef.current?.click(); }}
                  className="w-full py-3 rounded-xl text-sm font-medium border border-[#e8e2d9] bg-white text-[#2d2926] transition-colors hover:border-[#5c7f63]">
                  Choose photos
                </button>
                <button onClick={() => setFabActionSheet(false)}
                  className="w-full py-3 rounded-xl text-sm font-medium text-[#7a6f65] transition-colors hover:bg-[#f0ede8]">
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Instant Photo Bottom Sheet ─────────────────────────── */}
        {fabUrls.length > 0 && (
          <>
            {/* Dismiss is disabled mid-save: the upload loop iterates a snapshot
                taken before it started, so closing or removing a photo now would
                revoke a URL whose upload is still in flight, save it anyway, and
                report a count that does not match what the family sees. */}
            <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
              onClick={() => { if (!fabSaving) closeFabSheet(); }} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
              <div className="px-5 pb-5 space-y-4">
                {fabUrls.length === 1 ? (
                  <div className="relative rounded-2xl overflow-hidden bg-[#f0ede8]">
                    <img src={fabUrls[0]} alt="Preview" className="w-full max-h-56 object-cover" />
                    <button onClick={closeFabSheet} disabled={fabSaving} aria-label="Remove photo"
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors disabled:opacity-40 disabled:pointer-events-none">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1.5 pt-1.5 -mx-1 px-1">
                    {fabUrls.map((url, i) => (
                      <div key={url} className="relative shrink-0">
                        <img src={url} alt={`Photo ${i + 1}`} className="w-20 h-20 rounded-xl object-cover bg-[#f0ede8]" />
                        <button onClick={() => removeFabPhoto(i)} disabled={fabSaving} aria-label={`Remove photo ${i + 1}`}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors disabled:opacity-40 disabled:pointer-events-none">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {fabRemaining !== null && fabRemaining > 0 && (
                  <p className="text-xs text-[#7a6f65]">
                    You have {fabRemaining} {fabRemaining === 1 ? "photo" : "photos"} left on the free plan.
                  </p>
                )}
                {/* Labelled and explained, the same as the Today capture card
                    and both edit sheets. Two capture paths must not make two
                    different promises about what this text does. */}
                <div>
                  <label htmlFor="fab-caption" className="text-xs font-medium text-[#7a6f65] block mb-1.5">Caption</label>
                  <input id="fab-caption" type="text" value={fabCaption} onChange={(e) => setFabCaption(e.target.value)}
                    autoFocus disabled={fabSaving}
                    className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition-colors disabled:opacity-60" />
                  <p className="text-[11px] text-[#9a8f85] mt-1.5">This prints under the photo in your yearbook.</p>
                </div>
                {fabKids.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setFabChildId("")} disabled={fabSaving}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 ${fabChildId === "" ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"}`}>
                      Everyone
                    </button>
                    {fabKids.map((c) => (
                      <button key={c.id} type="button" onClick={() => setFabChildId(c.id)} disabled={fabSaving}
                        className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60"
                        style={fabChildId === c.id
                          ? { backgroundColor: c.color ?? "#5c7f63", color: "#fff", borderColor: c.color ?? "#5c7f63" }
                          : { backgroundColor: "#fff", color: "#7a6f65", borderColor: "#e8e2d9" }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                {fabNote && (
                  <p className="text-xs text-[#7a6f65] leading-snug">{fabNote}</p>
                )}
                {fabLimitHit && (
                  <div className="rounded-xl border border-[#e8e2d9] bg-[#faf8f4] px-4 py-3 space-y-1.5">
                    <p className="text-xs text-[#7a6f65]">You&apos;ve reached 50 photos on the free plan.</p>
                    <Link href="/dashboard/pricing" onClick={closeFabSheet}
                      className="inline-block text-xs font-medium underline"
                      style={{ color: "var(--g-gold)" }}>
                      Upgrade for unlimited photos
                    </Link>
                  </div>
                )}
                <button onClick={saveFabPhoto} disabled={fabSaving || fabFiles.length === 0}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all shadow-sm disabled:opacity-60"
                  style={{ backgroundColor: "var(--g-brand)" }}>
                  {fabSaving
                    ? (fabProgress && fabProgress.total > 1
                        ? `Saving ${fabProgress.current} of ${fabProgress.total}...`
                        : "Saving...")
                    : fabFiles.length > 1
                      ? `Save ${fabFiles.length} photos 🌱`
                      : "Save 🌱"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Leaf burst animation */}
        {leafBurst && (
          <>
            <style>{`
              @keyframes leafBurst {
                0% { opacity: 1; transform: translate(0, 0) scale(1); }
                100% { opacity: 0; transform: translate(var(--lx), var(--ly)) scale(0.6); }
              }
            `}</style>
            <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[70] pointer-events-none">
              {[
                { lx: "-24px", ly: "-36px" }, { lx: "20px", ly: "-40px" }, { lx: "-32px", ly: "-12px" },
                { lx: "28px", ly: "-16px" }, { lx: "-8px", ly: "-48px" }, { lx: "12px", ly: "-28px" },
              ].map((pos, i) => (
                <span
                  key={i}
                  className="absolute text-lg"
                  style={{
                    ["--lx" as string]: pos.lx,
                    ["--ly" as string]: pos.ly,
                    animation: `leafBurst 1.2s ${i * 0.05}s ease-out forwards`,
                  }}
                >🌿</span>
              ))}
            </div>
          </>
        )}

        {fabToast && (
          <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
            <div className="bg-[var(--g-deep)] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg max-w-[90vw] text-center">{fabToast}</div>
          </div>
        )}

        <BadgeNotificationListener />
      </div>
    </PartnerContext.Provider>
  );
}
