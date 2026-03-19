"use client";

import { useState } from "react";
import Link from "next/link";
import {
  HelpCircle,
  Mail,
  Smartphone,
  Sparkles,
  Shield,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ─── What's New entries ───────────────────────────────────────────────────────

const WHATS_NEW = [
  {
    label: "Admin business dashboard",
    detail: "Revenue, user counts, engagement, retention, daily activity, and upgrade candidates — all in one private view.",
  },
  {
    label: "Children insights & upgrade candidates",
    detail: "Admin dashboard now shows how many children each user has, active vs. dead accounts, and free users most likely to upgrade.",
  },
  {
    label: "Add to Home Screen onboarding step",
    detail: "A new final onboarding step walks new users through installing Rooted as a PWA on iPhone and Android.",
  },
  {
    label: "PWA app icon",
    detail: "Rooted now has a proper home screen icon — a clean lettermark on a green background — when you add it to your phone.",
  },
  {
    label: "Dashboard skeleton loader",
    detail: "The dashboard no longer shows a full-page spinner on load. A content-shaped skeleton fades in while your data loads.",
  },
];

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
        <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
          <Smartphone size={20} className="text-[#5c7f63]" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-[#2d2926]">How to install the app 📱</p>
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

// ─── What's New card ──────────────────────────────────────────────────────────

function WhatsNewCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
          <Sparkles size={20} className="text-[#5c7f63]" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-[#2d2926]">What&apos;s new 🌿</p>
          <p className="text-xs text-[#7a6f65]">Recent features and improvements</p>
        </div>
        {open
          ? <ChevronUp size={16} className="text-[#b5aca4] shrink-0" />
          : <ChevronDown size={16} className="text-[#b5aca4] shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-[#f0ede8]">
          <ul className="divide-y divide-[#f0ede8]">
            {WHATS_NEW.map((item, i) => (
              <li key={i} className="px-5 py-3.5">
                <p className="text-sm font-medium text-[#2d2926] mb-0.5">{item.label}</p>
                <p className="text-xs text-[#7a6f65] leading-relaxed">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type LinkItem = {
  icon: React.ElementType;
  label: string;
  sub: string;
  href?: string;
  mailto?: string;
};

const LINK_ITEMS: LinkItem[] = [
  {
    icon: HelpCircle,
    label: "FAQ",
    sub: "Answers to common questions",
    href: "/faq",
  },
  {
    icon: Mail,
    label: "Contact us",
    sub: "hello.rootedapp@gmail.com",
    mailto: "hello.rootedapp@gmail.com",
  },
  {
    icon: Shield,
    label: "Privacy Policy",
    sub: "How we handle your data",
    href: "/privacy",
  },
  {
    icon: FileText,
    label: "Terms of Service",
    sub: "Usage terms and conditions",
    href: "/terms",
  },
];

export default function MorePage() {
  return (
    <div className="max-w-xl mx-auto px-5 py-8 space-y-8">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a9e7e] mb-1">Dashboard</p>
        <h1 className="text-2xl font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
          Help &amp; More
        </h1>
      </div>

      {/* Expandable feature cards */}
      <div className="space-y-3">
        <InstallCard />
        <WhatsNewCard />
      </div>

      {/* Link list */}
      <div className="space-y-2">
        {LINK_ITEMS.map(({ icon: Icon, label, sub, href, mailto }) => {
          const inner = (
            <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#f0ede8] flex items-center justify-center shrink-0">
                <Icon size={20} className="text-[#7a6f65]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2d2926]">{label}</p>
                <p className="text-xs text-[#7a6f65] truncate">{sub}</p>
              </div>
              <span className="text-[#c8bfb5] text-lg leading-none">›</span>
            </div>
          );

          if (mailto) {
            return (
              <a
                key={label}
                href={`mailto:${mailto}`}
                className="block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden"
              >
                {inner}
              </a>
            );
          }

          return (
            <Link
              key={label}
              href={href!}
              className="block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden"
            >
              {inner}
            </Link>
          );
        })}
      </div>

      <p className="text-center text-xs text-[#c8bfb5] pb-4">
        Rooted Homeschool · Built with love for learning families
      </p>
    </div>
  );
}
