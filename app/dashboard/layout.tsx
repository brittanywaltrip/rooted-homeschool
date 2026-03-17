"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sun,
  ClipboardList,
  BarChart2,
  Lightbulb,
  MoreHorizontal,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const navItems = [
  { label: "Today", href: "/dashboard", icon: Sun },
  { label: "Plan", href: "/dashboard/plan", icon: ClipboardList },
  { label: "Progress", href: "/dashboard/progress", icon: BarChart2 },
  { label: "Insights", href: "/dashboard/insights", icon: Lightbulb },
  { label: "More", href: "/dashboard/more", icon: MoreHorizontal },
];

function NavLink({
  label,
  href,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  href: string;
  icon: React.ElementType;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        active
          ? "bg-[#e8f0e9] text-[#3d5c42]"
          : "text-[#7a6f65] hover:bg-[#f0ede8] hover:text-[#2d2926]"
      }`}
    >
      <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
      {label}
    </Link>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace("/login");
      else setChecking(false);
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

  const sidebarNav = (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#e8e2d9]">
        <Link
          href="/dashboard"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-2"
        >
          <span className="text-xl">🌿</span>
          <span className="text-base font-bold text-[#5c7f63] tracking-tight">
            Rooted
          </span>
        </Link>
      </div>

      {/* Nav items */}
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

      {/* Sign out */}
      <div className="p-3 border-t border-[#e8e2d9]">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] hover:text-[#2d2926] w-full transition-colors"
        >
          <LogOut size={18} strokeWidth={1.8} />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f8f7f4] flex">
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-52 bg-[#fefcf9] border-r border-[#e8e2d9] fixed top-0 left-0 h-full z-40">
        {sidebarNav}
      </aside>

      {/* ── Mobile drawer backdrop ───────────────────────── */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ── Mobile sidebar drawer ────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full w-52 bg-[#fefcf9] border-r border-[#e8e2d9] z-50 flex flex-col transition-transform duration-200 md:hidden ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarNav}
      </aside>

      {/* ── Main area ────────────────────────────────────── */}
      <main className="flex-1 md:ml-52 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#fefcf9] border-b border-[#e8e2d9] sticky top-0 z-30">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-[#7a6f65] p-0.5"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="text-sm font-bold text-[#5c7f63]">🌿 Rooted</span>
        </div>

        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
