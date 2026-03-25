"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Sun, Leaf, Camera, Calendar, Search, Menu, X, Settings, Megaphone, LogOut } from "lucide-react";
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

// Primary tabs shown in mobile bottom nav (5 links + Menu button)
const mobileBottomNav = [
  { label: "Today",     href: "/dashboard",            icon: Sun      },
  { label: "Plan",      href: "/dashboard/plan",       icon: Calendar },
  { label: "Garden",    href: "/dashboard/garden",     icon: Leaf     },
  { label: "Memories",  href: "/dashboard/memories",   icon: Camera   },
  { label: "Resources", href: "/dashboard/resources",  icon: Search   },
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

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { displayName: profileName } = useProfile();
  const [checking,  setChecking]  = useState(true);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [menuSheet, setMenuSheet] = useState(false);
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [profileData, setProfileData] = useState<{ first_name?: string | null; family_photo_url?: string | null }>({});
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
          className="w-8 h-8 rounded-full bg-[#e8f0e9] flex items-center justify-center text-xs font-bold text-[#3d5c42] hover:bg-[#d4e8d4] transition-colors shrink-0 overflow-hidden"
        >
          {profileData.family_photo_url ? (
            <img src={profileData.family_photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
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
        {/* Mobile top bar — brand only */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9] sticky top-0 z-30">
            <div className="flex items-center gap-2">
              <span className="text-base">🌿</span>
              <span className="text-sm font-bold text-[#2d2926]">Rooted</span>
            </div>
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

        {/* Mobile bottom nav bar — 6 tabs */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#fefcf9] border-t border-[#e8e2d9] flex items-stretch" style={{ minHeight: "3.75rem", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {mobileBottomNav.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuSheet(false)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition-colors ${
                  active ? "text-[#3d5c42]" : "text-[#c8bfb5]"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                {label}
              </Link>
            );
          })}
          {/* Menu tab */}
          <button
            onClick={() => setMenuSheet(!menuSheet)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[9px] font-medium transition-colors ${
              menuSheet ? "text-[#3d5c42]" : "text-[#c8bfb5]"
            }`}
          >
            <Menu size={22} strokeWidth={menuSheet ? 2.5 : 1.8} />
            Menu
          </button>
        </nav>

        {/* Menu sheet — slides up from bottom */}
        {menuSheet && (
          <>
            <div className="md:hidden fixed inset-0 bg-black/30 z-50" onClick={() => setMenuSheet(false)} />
            <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#fefcf9] rounded-t-2xl border-t border-[#e8e2d9] shadow-xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 3.75rem)" }}>
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-[#e8e2d9]" />
              </div>

              {/* Family name + photo */}
              <div className="px-5 pb-3 border-b border-[#e8e2d9] flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-[#e8f0e9] flex items-center justify-center text-sm font-bold text-[#3d5c42] shrink-0 overflow-hidden">
                  {profileData.family_photo_url ? (
                    <img src={profileData.family_photo_url} alt="" className="w-11 h-11 rounded-full object-cover" />
                  ) : displayName ? (
                    displayName.charAt(0).toUpperCase()
                  ) : "🌿"}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#2d2926]">{displayName || "Your Family"}</p>
                  <p className="text-[11px] text-[#7a6f65]">Rooted Homeschool</p>
                </div>
              </div>

              {/* Menu items */}
              <div className="px-3 py-2 space-y-0.5">
                <Link href="/dashboard/settings" onClick={() => setMenuSheet(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] transition-colors">
                  <Settings size={18} className="text-[#7a6f65]" />
                  Settings
                </Link>
                <Link href="/dashboard/more/whats-new" onClick={() => setMenuSheet(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] transition-colors">
                  <Megaphone size={18} className="text-[#7a6f65]" />
                  What&apos;s New
                </Link>
                {isAdmin && (
                  <Link href="/admin" onClick={() => setMenuSheet(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] transition-colors">
                    <span className="text-[15px]">🔒</span>
                    Founder Dashboard
                  </Link>
                )}
              </div>

              {/* Sign out */}
              <div className="px-3 pb-4 pt-1 border-t border-[#e8e2d9]">
                <button
                  onClick={() => { setMenuSheet(false); handleSignOut(); }}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-[#7a6f65] hover:bg-red-50 hover:text-red-600 w-full transition-colors"
                >
                  <LogOut size={18} />
                  Sign Out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </PartnerContext.Provider>
  );
}
