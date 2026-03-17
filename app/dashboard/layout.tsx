"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Sun, Leaf, BookOpen, Camera, FileText, Menu, X, LogOut, Settings, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabase";

const navItems = [
  { label: "Today",     href: "/dashboard",            icon: Sun       },
  { label: "Plan",      href: "/dashboard/plan",       icon: Calendar  },
  { label: "Garden",    href: "/dashboard/garden",     icon: Leaf      },
  { label: "Resources", href: "/dashboard/resources",  icon: BookOpen  },
  { label: "Memories",  href: "/dashboard/memories",   icon: Camera    },
  { label: "Reports",   href: "/dashboard/reports",    icon: FileText  },
];

function NavLink({
  label, href, icon: Icon, active, onClick,
}: {
  label: string; href: string; icon: React.ElementType;
  active: boolean; onClick?: () => void;
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
      <Icon size={17} strokeWidth={active ? 2.5 : 1.8} />
      {label}
      {active && (
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#5c7f63]" />
      )}
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [checking,  setChecking]  = useState(true);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [familyName, setFamilyName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
      } else {
        setChecking(false);
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", session.user.id)
          .maybeSingle();
        setFamilyName(
          profile?.display_name || session.user.user_metadata?.family_name || ""
        );
      }
    });
  }, [router]);

  async function handleSignOut() {
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
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-3xl animate-pulse">🌿</span>
          <p className="text-sm text-[#7a6f65]">Loading your space…</p>
        </div>
      </div>
    );
  }

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
            <span className="text-[10px] text-[#7a6f65] leading-none">Homeschool</span>
          </div>
        </Link>
      </div>

      {/* Family name */}
      {familyName && (
        <div className="px-5 py-3 border-b border-[#f0ede8]">
          <p className="text-xs text-[#b5aca4]">Signed in as</p>
          <p className="text-sm font-medium text-[#5c7f63] truncate">{familyName}</p>
        </div>
      )}

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
        <NavLink
          label="Settings"
          href="/dashboard/settings"
          icon={Settings}
          active={isActive("/dashboard/settings")}
          onClick={() => setMenuOpen(false)}
        />
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#7a6f65] hover:bg-red-50 hover:text-red-600 w-full transition-colors"
        >
          <LogOut size={16} strokeWidth={1.8} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
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
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9] sticky top-0 z-30">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-[#7a6f65] p-0.5"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-base">🌿</span>
            <span className="text-sm font-bold text-[#2d2926]">Rooted</span>
          </div>
        </div>

        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
