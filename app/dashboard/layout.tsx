"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Sun, Leaf, BookOpen, Camera, FileText, Menu, X, LogOut, Settings, Calendar, MoreHorizontal, GraduationCap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PartnerContext, PartnerContextType } from "@/lib/partner-context";
import { ProfileProvider, useProfile } from "@/lib/profile-context";

const navItems = [
  { label: "Today",      href: "/dashboard",           icon: Sun           },
  { label: "Plan",       href: "/dashboard/plan",      icon: Calendar      },
  { label: "Garden",     href: "/dashboard/garden",    icon: Leaf          },
  { label: "Resources",  href: "/dashboard/resources", icon: BookOpen      },
  { label: "Progress",   href: "/dashboard/progress",  icon: GraduationCap },
  { label: "Memories",   href: "/dashboard/memories",  icon: Camera        },
];

// Primary tabs shown in mobile bottom nav
const mobileBottomNav = [
  { label: "Today",     href: "/dashboard",           icon: Sun      },
  { label: "Garden",    href: "/dashboard/garden",    icon: Leaf     },
  { label: "Resources", href: "/dashboard/resources", icon: BookOpen },
  { label: "Memories",  href: "/dashboard/memories",  icon: Camera   },
  { label: "Reports",   href: "/dashboard/reports",   icon: FileText },
];

function getISOWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  );
  return `${d.getFullYear()}-W${weekNum}`;
}

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
          ? "bg-[#e8f0e9] text-[#3d5c42] shadow-sm"
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
      {active && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#5c7f63]" />
      )}
    </Link>
  );
}

// Extracted so it has its OWN context subscription — re-renders whenever
// ProfileContext updates, independent of DashboardLayoutInner's render cycle.
function SidebarProfile({ isPartner, ownerName }: { isPartner: boolean; ownerName: string }) {
  const { displayName: profileName, familyPhotoUrl } = useProfile();
  const displayName = isPartner ? ownerName : (profileName || "");

  console.log("[SidebarProfile] render — displayName:", JSON.stringify(displayName), "photo:", familyPhotoUrl ? "set" : "null");

  const initial = (() => {
    if (!displayName) return null;
    const core = displayName.replace(/^the\s+/i, "").replace(/\s*family\s*$/i, "").trim();
    return (core || displayName).charAt(0).toUpperCase() || null;
  })();

  return (
    <div className="px-4 py-3 border-b border-[#f0ede8] flex items-center gap-3">
      {familyPhotoUrl && !isPartner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={familyPhotoUrl}
          alt="Family photo"
          className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#e8e2d9]"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-[#5c7f63] flex items-center justify-center shrink-0 text-sm font-bold text-white">
          {initial ?? "🌿"}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[11px] text-[#b5aca4] leading-none mb-0.5">
          {isPartner ? "Viewing family" : (displayName ? "Welcome back," : "Welcome back!")}
        </p>
        <p data-sidebar-name className="text-sm font-medium text-[#5c7f63] truncate leading-tight">
          {displayName || (isPartner ? "" : "Your Family")}
        </p>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </ProfileProvider>
  );
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { displayName: profileName } = useProfile();
  const [checking,        setChecking]        = useState(true);
  const [menuOpen,           setMenuOpen]           = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [resourcesBadge,     setResourcesBadge]     = useState(false);
  const [partnerCtx,  setPartnerCtx]  = useState<PartnerContextType>({
    isPartner: false,
    effectiveUserId: "",
    ownerName: "",
  });

  // Clear badge when user visits Resources
  useEffect(() => {
    if (pathname === "/dashboard/resources") {
      localStorage.setItem("resources_seen_week", getISOWeekKey());
      setResourcesBadge(false);
    }
  }, [pathname]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }

      // Check if Resources has new Fresh Drops this week
      const seenWeek = localStorage.getItem("resources_seen_week");
      if (seenWeek !== getISOWeekKey()) {
        setResourcesBadge(true);
      }

      // Load family name + subscription status
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, subscription_status, family_photo_url, onboarded")
        .eq("id", session.user.id)
        .maybeSingle();

      // Gate: send new (non-onboarded) users through the wizard
      if ((profile as { onboarded?: boolean } | null)?.onboarded === false) {
        router.replace("/onboarding");
        return;
      }

      setSubscriptionStatus(profile?.subscription_status ?? null);

      // ── Partner detection ──────────────────────────────────────────────────
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
      <div className="px-5 py-5 border-b border-[#e8e2d9]">
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
      </div>

      {/* Family avatar + name — reads directly from ProfileContext */}
      <SidebarProfile isPartner={partnerCtx.isPartner} ownerName={partnerCtx.ownerName} />

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
            badge={href === "/dashboard/resources" && resourcesBadge}
          />
        ))}
      </nav>

      {/* Child View button */}
      <div className="px-3 pb-1">
        <Link
          href="/child"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#e8f5ea] to-[#f0f7e8] text-[#3d5c42] hover:from-[#d4ead4] hover:to-[#e4f0d4] transition-colors"
        >
          <span className="text-base">🌱</span>
          Child View
        </Link>
      </div>

      {/* Upgrade to Pro */}
      {subscriptionStatus !== 'active' && (
        <div className="px-3 pb-2">
          <Link
            href="/upgrade"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#5c7f63] to-[#3d8c5c] text-white hover:from-[#3d5c42] hover:to-[#2d6644] transition-colors shadow-sm"
          >
            <span className="text-base">✨</span>
            Upgrade to Pro
          </Link>
        </div>
      )}

      {/* Settings + Sign out */}
      <div className="p-3 border-t border-[#e8e2d9] space-y-0.5">
        <NavLink
          label="More"
          href="/dashboard/more"
          icon={MoreHorizontal}
          active={isActive("/dashboard/more")}
          onClick={() => setMenuOpen(false)}
        />
        {!partnerCtx.isPartner && (
          <NavLink
            label="Settings"
            href="/dashboard/settings"
            icon={Settings}
            active={isActive("/dashboard/settings")}
            onClick={() => setMenuOpen(false)}
          />
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
          {/* Mobile top bar — brand only; primary nav is in bottom bar */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9] sticky top-0 z-30">
            <div className="flex items-center gap-2">
              <span className="text-base">🌿</span>
              <span className="text-sm font-bold text-[#2d2926]">Rooted</span>
            </div>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-[#7a6f65] p-1 rounded-lg hover:bg-[#f0ede8]"
              aria-label="More options"
            >
              <MoreHorizontal size={20} />
            </button>
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

          <div className="flex-1 pb-16 md:pb-0">{children}</div>
        </main>

        {/* Mobile bottom nav bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#fefcf9] border-t border-[#e8e2d9] flex items-stretch safe-area-inset-bottom" style={{ height: "3.75rem" }}>
          {mobileBottomNav.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            const isBadged = href === "/dashboard/resources" && resourcesBadge;
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  active ? "text-[#3d5c42]" : "text-[#7a6f65]"
                }`}
              >
                <div className={`relative p-1.5 rounded-lg ${active ? "bg-[#e8f0e9]" : ""}`}>
                  <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
                  {isBadged && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#c4956a] border border-[#fefcf9]" />
                  )}
                </div>
                {label}
              </Link>
            );
          })}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[#7a6f65]"
          >
            <div className="p-1.5 rounded-lg">
              <Menu size={18} strokeWidth={1.8} />
            </div>
            More
          </button>
        </nav>
      </div>
    </PartnerContext.Provider>
  );
}
