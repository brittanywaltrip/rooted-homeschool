"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  HelpCircle,
  Mail,
  ChevronDown,
  ChevronUp,
  Settings,
  LogOut,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHero from "@/app/components/PageHero";

// ─── Install instructions card ────────────────────────────────────────────────

function InstallCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0 text-lg">
          📱
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-[#2d2926]">Install the App</p>
          <p className="text-xs text-[#7a6f65]">Add Rooted to your home screen</p>
        </div>
        {open
          ? <ChevronUp size={16} className="text-[#b5aca4] shrink-0" />
          : <ChevronDown size={16} className="text-[#b5aca4] shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-[#f0ede8] px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#f8f5f0] rounded-xl p-3.5 border border-[#ede8de]">
              <p className="text-base mb-1.5">🍎</p>
              <p className="text-xs font-bold text-[#2d2926] mb-2">iPhone</p>
              <ol className="text-xs text-[#7a6f65] space-y-1 leading-relaxed">
                <li>Open in <span className="font-medium text-[#2d2926]">Safari</span></li>
                <li>Tap the Share button <span className="font-medium">⬆️</span></li>
                <li>Tap <span className="font-medium text-[#2d2926]">&quot;Add to Home Screen&quot;</span></li>
                <li>Tap <span className="font-medium text-[#2d2926]">Add</span></li>
              </ol>
            </div>
            <div className="bg-[#f8f5f0] rounded-xl p-3.5 border border-[#ede8de]">
              <p className="text-base mb-1.5">🤖</p>
              <p className="text-xs font-bold text-[#2d2926] mb-2">Android</p>
              <ol className="text-xs text-[#7a6f65] space-y-1 leading-relaxed">
                <li>Open in <span className="font-medium text-[#2d2926]">Chrome</span></li>
                <li>Tap the menu <span className="font-medium">⋮</span></li>
                <li>Tap <span className="font-medium text-[#2d2926]">&quot;Add to Home Screen&quot;</span></li>
                <li>Tap <span className="font-medium text-[#2d2926]">Add</span></li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type CardItem = {
  emoji?: string;
  icon?: React.ElementType;
  label: string;
  sub: string;
  href?: string;
  mailto?: string;
  accent?: boolean;
};

// ─── Reusable row card ────────────────────────────────────────────────────────

function RowCard({ item }: { item: CardItem }) {
  const { emoji, icon: Icon, label, sub, href, mailto, accent } = item;

  const inner = (
    <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent ? "bg-[#e8f0e9]" : "bg-[#f0ede8]"}`}>
        {emoji
          ? <span className="text-lg">{emoji}</span>
          : Icon
          ? <Icon size={20} className={accent ? "text-[#5c7f63]" : "text-[#7a6f65]"} />
          : null}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#2d2926]">{label}</p>
        <p className="text-xs text-[#7a6f65] truncate">{sub}</p>
      </div>
      <span className="text-[#c8bfb5] text-lg leading-none">›</span>
    </div>
  );

  const cls = `block bg-[#fefcf9] border rounded-2xl overflow-hidden ${accent ? "border-[#c8ddb8]" : "border-[#e8e2d9]"}`;

  if (mailto) return <a href={`mailto:${mailto}`} className={cls}>{inner}</a>;
  return <Link href={href!} className={cls}>{inner}</Link>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const FEATURE_ITEMS: CardItem[] = [
  { emoji: "📚", label: "Resources",  sub: "Deals, freebies & field trips",    href: "/dashboard/resources",  accent: true },
  { emoji: "📈", label: "Progress",   sub: "Track learning over time",         href: "/dashboard/garden",     accent: true },
  { emoji: "📋", label: "Reports",    sub: "Generate progress reports",        href: "/dashboard/reports",    accent: true },
  { emoji: "🖨️", label: "Printables", sub: "Worksheets and activity sheets",   href: "/dashboard/printables", accent: true },
];

const HELP_ITEMS: CardItem[] = [
  { icon: HelpCircle, label: "FAQ",        sub: "Answers to common questions",  href: "/faq" },
  { icon: Mail,       label: "Contact Us", sub: "hello@rootedhomeschoolapp.com",    mailto: "hello@rootedhomeschoolapp.com" },
];

// Most recent update date as ISO string (first of the month)
const LATEST_UPDATE_DATE = "2026-03-01";
const LAST_SEEN_KEY = "rooted_whats_new_last_seen";

export default function MorePage() {
  const router = useRouter();
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => { document.title = "More \u00b7 Rooted"; }, []);

  useEffect(() => {
    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    setHasUnread(!lastSeen || lastSeen < LATEST_UPDATE_DATE);
  }, []);

  async function handleSignOut() {
    sessionStorage.removeItem("rooted_partner");
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
    <PageHero
      overline="Tools & Extras"
      title="More 🌿"
      subtitle="Everything else, all in one place."
    />
    <div className="max-w-xl mx-auto px-5 pt-5 pb-8 space-y-8">

      {/* What's New */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4]">Updates</p>
        <Link
          href="/dashboard/more/whats-new"
          className="block bg-[#fefcf9] border border-[#c8ddb8] rounded-2xl overflow-hidden"
        >
          <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors">
            <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0 text-lg">
              🌱
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[#2d2926]">What&apos;s New</p>
                {hasUnread && (
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-label="Unread updates" />
                )}
              </div>
              <p className="text-xs text-[#7a6f65]">Latest updates &amp; improvements</p>
            </div>
            <span className="text-[#c8bfb5] text-lg leading-none">›</span>
          </div>
        </Link>
      </div>

      {/* Feature pages */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4]">Pages</p>
        <div className="space-y-2">
          {FEATURE_ITEMS.map((item) => <RowCard key={item.label} item={item} />)}
        </div>
      </div>

      {/* Install app */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4]">App</p>
        <InstallCard />
      </div>

      {/* Help links */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4]">Help</p>
        <div className="space-y-2">
          {HELP_ITEMS.map((item) => <RowCard key={item.label} item={item} />)}
        </div>
      </div>

      {/* Account */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4]">Account</p>
        <div className="space-y-2">
          <Link
            href="/dashboard/settings"
            className="block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden"
          >
            <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0ede8] flex items-center justify-center shrink-0">
                <Settings size={20} className="text-[#7a6f65]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2d2926]">Settings</p>
                <p className="text-xs text-[#7a6f65]">Manage your family profile</p>
              </div>
              <span className="text-[#c8bfb5] text-lg leading-none">›</span>
            </div>
          </Link>
          <button
            onClick={handleSignOut}
            className="w-full block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden text-left"
          >
            <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0ede8] flex items-center justify-center shrink-0">
                <LogOut size={20} className="text-[#7a6f65]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2d2926]">Sign Out</p>
                <p className="text-xs text-[#7a6f65]">Log out of your account</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-[#c8bfb5] pb-4">
        Rooted · Built with love for learning families
      </p>
    </div>
    </>
  );
}
