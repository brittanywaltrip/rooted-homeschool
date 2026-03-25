"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Sun, Leaf, Camera, Calendar, Search, Menu, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PartnerContext, PartnerContextType } from "@/lib/partner-context";
import UpgradeBanner from "@/app/components/UpgradeBanner";
import { ProfileProvider, useProfile } from "@/lib/profile-context";

const navItems = [
  { label: "Today",     href: "/dashboard",           icon: Sun      },
  { label: "Plan",      href: "/dashboard/plan",      icon: Calendar },
  { label: "Garden",    href: "/dashboard/garden",    icon: Leaf     },
  { label: "Memories",  href: "/dashboard/memories",  icon: Camera   },
  { label: "Resources", href: "/dashboard/resources",  icon: Search   },
];

/* NAV ORDER — DO NOT CHANGE: Today → Plan → Garden → Memories → Resources → More
   This order is intentional. Any reorder breaks mobile UX. Verify before merging. */
const mobileBottomNav = [
  { label: "Today",     href: "/dashboard",            icon: Sun      },
  { label: "Plan",      href: "/dashboard/plan",       icon: Calendar },
  { label: "Garden",    href: "/dashboard/garden",     icon: Leaf     },
  { label: "Memories",  href: "/dashboard/memories",   icon: Camera   },
  { label: "Resources", href: "/dashboard/resources",  icon: Search   },
  { label: "More",      href: "/dashboard/settings",   icon: Menu     },
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
          ? "text-[#3d5c42]"
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </ProfileProvider>
  );
}

type FabChild = { id: string; name: string; color: string | null };

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { displayName: profileName } = useProfile();
  const [checking,  setChecking]  = useState(true);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [profileData, setProfileData] = useState<{ first_name?: string | null; family_photo_url?: string | null }>({});

  // ── Floating camera FAB state ────────────────────────────────────────────
  const fabFileRef = useRef<HTMLInputElement>(null);
  const [fabKids, setFabKids] = useState<FabChild[]>([]);
  const [fabFile, setFabFile] = useState<File | null>(null);
  const [fabUrl, setFabUrl] = useState<string | null>(null);
  const [fabCaption, setFabCaption] = useState("");
  const [fabChildId, setFabChildId] = useState("");
  const [fabSaving, setFabSaving] = useState(false);
  const [fabToast, setFabToast] = useState<string | null>(null);
  const [leafBurst, setLeafBurst] = useState(false);

  const [partnerCtx,  setPartnerCtx]  = useState<PartnerContextType>({
    isPartner: false,
    effectiveUserId: "",
    ownerName: "",
  });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }

      const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];
      if (ADMIN_EMAILS.includes(session.user.email ?? "")) {
        setIsAdmin(true);
      }

      // Load family name + subscription status
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, subscription_status, family_photo_url, first_name, onboarded")
        .eq("id", session.user.id)
        .maybeSingle();

      // Gate: send new (non-onboarded) users through the wizard
      if ((profile as { onboarded?: boolean } | null)?.onboarded === false) {
        router.replace("/onboarding");
        return;
      }

      // ── Partner detection ──────────────────────────────────────────────────
      // The owner/admin account is never a partner view — skip the check entirely.
      if (session.user.email === "garfieldbrittany@gmail.com") {
        sessionStorage.removeItem("rooted_partner");
        setPartnerCtx({ isPartner: false, effectiveUserId: session.user.id, ownerName: "" });
        if (profile) setProfileData({ first_name: (profile as any).first_name, family_photo_url: (profile as any).family_photo_url });
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
      const email = session.user.email;
      if (email) {
        const { data: ownerProfile, error: partnerErr } = await supabase
          .from("profiles")
          .select("id, display_name")
          .eq("partner_email", email)
          .maybeSingle();

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
        effectiveUserId: session.user.id,
        ownerName: "",
      });
      if (profile) setProfileData({ first_name: (profile as any).first_name, family_photo_url: (profile as any).family_photo_url });
      setChecking(false);
    });
  }, [router]);

  async function handleSignOut() {
    sessionStorage.removeItem("rooted_partner");
    await supabase.auth.signOut();
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
    setFabKids((data as FabChild[]) ?? []);
  }, [partnerCtx.effectiveUserId, partnerCtx.isPartner]);
  useEffect(() => { if (!checking) loadFabKids(); }, [checking, loadFabKids]);

  function openFabPicker() { fabFileRef.current?.click(); }
  function onFabFileChosen(file: File) {
    setFabFile(file); setFabUrl(URL.createObjectURL(file)); setFabCaption(""); setFabChildId("");
  }
  function closeFabSheet() {
    setFabFile(null); if (fabUrl) URL.revokeObjectURL(fabUrl); setFabUrl(null); setFabCaption(""); setFabChildId("");
  }
  async function saveFabPhoto() {
    if (!fabFile || fabSaving) return;
    setFabSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setFabSaving(false); return; }
    const path = `${user.id}/${Date.now()}-${fabFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("memory-photos").upload(path, fabFile, { contentType: fabFile.type, upsert: false });
    if (upErr) { setFabSaving(false); return; }
    const { data: urlData } = supabase.storage.from("memory-photos").getPublicUrl(path);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await supabase.from("app_events").insert({
      user_id: user.id, type: "memory_photo",
      payload: { photo_url: urlData.publicUrl, title: fabCaption.trim() || undefined, child_id: fabChildId || undefined, date: today },
    });
    await supabase.rpc("increment_photo_count", { p_user_id: user.id });
    setFabSaving(false); closeFabSheet();
    setLeafBurst(true); setTimeout(() => setLeafBurst(false), 1200);
    setFabToast("Memory saved 🌿"); setTimeout(() => setFabToast(null), 2000);
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
        <main className="flex-1 md:ml-52 flex flex-col min-h-screen">
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
          <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">
            🌿
          </div>
          <div>
            <span className="text-sm font-bold text-[#2d2926] block leading-none">Rooted</span>
            <span className="text-[10px] text-[#7a6f65] leading-none">{displayName || "Homeschool"}</span>
          </div>
        </Link>
        <Link
          href="/dashboard/settings"
          onClick={() => setMenuOpen(false)}
          className="w-10 h-10 rounded-full bg-[#e8f0e9] flex items-center justify-center text-sm font-bold text-[#3d5c42] hover:bg-[#d4e8d4] transition-colors shrink-0 overflow-hidden"
        >
          {profileData.family_photo_url ? (
            <img src={profileData.family_photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : profileData.first_name ? (
            profileData.first_name.charAt(0).toUpperCase()
          ) : displayName ? (
            displayName.charAt(0).toUpperCase()
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
            {(() => {
              const words = displayName.replace(/\bfamily\b/gi, "").trim().split(/\s+/).filter(Boolean);
              return words.length > 0 ? words[words.length - 1].charAt(0).toUpperCase() : "🌿";
            })()}
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
        <main className="flex-1 md:ml-52 flex flex-col min-h-screen">
          <UpgradeBanner />
        {/* Mobile top bar — brand + avatar */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9] sticky top-0 z-30">
            <div className="flex items-center gap-2">
              <span className="text-base">🌿</span>
              <span className="text-sm font-bold text-[#2d2926]">Rooted</span>
            </div>
            <Link
              href="/dashboard/settings"
              className="w-10 h-10 rounded-full bg-[#e8f0e9] flex items-center justify-center text-sm font-bold text-[#3d5c42] hover:bg-[#d4e8d4] transition-colors shrink-0 overflow-hidden"
            >
              {profileData.family_photo_url ? (
                <img src={profileData.family_photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : profileData.first_name ? (
                profileData.first_name.charAt(0).toUpperCase()
              ) : displayName ? (
                displayName.charAt(0).toUpperCase()
              ) : '🌿'}
            </Link>
          </div>

          {/* Partner banner */}
          {partnerCtx.isPartner && (
            <div className="bg-[#e8f5ea] border-b border-[#b8d9bc] px-4 py-2.5 flex items-center gap-2">
              <span className="text-sm">👀</span>
              <p className="text-xs font-medium text-[#3d5c42]">
                Viewing{partnerCtx.ownerName ? ` ${partnerCtx.ownerName}'s` : ""} family dashboard as a partner
                <span className="ml-2 text-[#5c7f63] opacity-80">· read-only</span>
              </p>
            </div>
          )}

          <div className="flex-1 pb-24 md:pb-0">{children}</div>
        </main>

        {/* Mobile bottom nav bar — 5 tabs */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#fefcf9] border-t border-[#e8e2d9] flex items-stretch" style={{ minHeight: "3.75rem", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {mobileBottomNav.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition-colors ${
                  active ? "text-[#3d5c42]" : "text-[#c8bfb5]"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                {label}
              </Link>
            );
          })}
        </nav>


        {/* ── Floating Camera FAB ───────────────────────────────── */}
        {!partnerCtx.isPartner && !fabUrl && (
          <button onClick={openFabPicker}
            className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all hover:shadow-xl"
            style={{ backgroundColor: "#2d5a3d" }} aria-label="Log a memory">
            <Camera size={22} className="text-white" strokeWidth={2.2} />
          </button>
        )}
        <input ref={fabFileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (e.target) e.target.value = ""; if (f) onFabFileChosen(f); }} />

        {/* ── Instant Photo Bottom Sheet ─────────────────────────── */}
        {fabUrl && (
          <>
            <div className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" onClick={closeFabSheet} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-3xl shadow-2xl max-w-lg mx-auto"
              style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-[#e8e2d9]" /></div>
              <div className="px-5 pb-5 space-y-4">
                <div className="relative rounded-2xl overflow-hidden bg-[#f0ede8]">
                  <img src={fabUrl} alt="Preview" className="w-full max-h-56 object-cover" />
                  <button onClick={closeFabSheet}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <input type="text" value={fabCaption} onChange={(e) => setFabCaption(e.target.value)}
                  placeholder="What's this?" autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20 transition-colors" />
                {fabKids.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setFabChildId("")}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${fabChildId === "" ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"}`}>
                      Everyone
                    </button>
                    {fabKids.map((c) => (
                      <button key={c.id} type="button" onClick={() => setFabChildId(c.id)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                        style={fabChildId === c.id
                          ? { backgroundColor: c.color ?? "#5c7f63", color: "#fff", borderColor: c.color ?? "#5c7f63" }
                          : { backgroundColor: "#fff", color: "#7a6f65", borderColor: "#e8e2d9" }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={saveFabPhoto} disabled={fabSaving}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all shadow-sm disabled:opacity-60"
                  style={{ backgroundColor: "#2d5a3d" }}>
                  {fabSaving ? "Saving..." : "Save 🌱"}
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
            <div className="bg-[#3d5c42] text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap">{fabToast}</div>
          </div>
        )}
      </div>
    </PartnerContext.Provider>
  );
}
