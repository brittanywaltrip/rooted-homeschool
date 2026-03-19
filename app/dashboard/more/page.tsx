"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Camera,
  FileText,
  Printer,
  HelpCircle,
  Mail,
  Smartphone,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

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
  { emoji: "📸", label: "Memories",   sub: "Photos, projects, and books",     href: "/dashboard/memories",   accent: true },
  { emoji: "📋", label: "Reports",    sub: "Generate progress reports",        href: "/dashboard/reports",    accent: true },
  { emoji: "🖨️", label: "Printables", sub: "Worksheets and activity sheets",   href: "/dashboard/printables", accent: true },
];

const HELP_ITEMS: CardItem[] = [
  { icon: HelpCircle, label: "FAQ",        sub: "Answers to common questions",  href: "/faq" },
  { icon: Mail,       label: "Contact Us", sub: "hello.rootedapp@gmail.com",    mailto: "hello.rootedapp@gmail.com" },
];

export default function MorePage() {
  return (
    <div className="max-w-xl mx-auto px-5 py-8 space-y-8">

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a9e7e] mb-1">Dashboard</p>
        <h1 className="text-2xl font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
          More
        </h1>
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

      <p className="text-center text-xs text-[#c8bfb5] pb-4">
        Rooted Homeschool · Built with love for learning families
      </p>
    </div>
  );
}
