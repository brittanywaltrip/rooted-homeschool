"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BookOpen, FileText, Sparkles, HelpCircle, Mail, Settings, ChevronRight, GraduationCap } from "lucide-react";
import PageHero from "@/app/components/PageHero";

const items = [
  { label: "Resources",  sub: "Deals, freebies & field trips",       href: "/dashboard/resources",        icon: BookOpen  },
  { label: "Transcripts", sub: "Courses, GPA & official transcripts", href: "/dashboard/transcript",       icon: GraduationCap },
  { label: "Hours Log",  sub: "Hours logged, subjects & attendance",  href: "/dashboard/reports",          icon: FileText  },
  { label: "What's New", sub: "Latest updates & improvements",       href: "/dashboard/more/whats-new",   icon: Sparkles  },
  { label: "FAQ",        sub: "Common questions",                    href: "/faq",                        icon: HelpCircle },
  { label: "Contact",    sub: "Get in touch",                        href: "/contact",                    icon: Mail      },
  { label: "Settings",   sub: "Your account",                        href: "/dashboard/settings",         icon: Settings  },
];

export default function MorePage() {
  useEffect(() => { document.title = "More \u00b7 Rooted"; }, []);

  return (
    <>
      <PageHero overline="More" title="More" subtitle="Everything else, all in one place." />
      <div className="max-w-xl mx-auto px-5 pt-5 pb-10">
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
          {items.map(({ label, sub, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-4 px-5 py-4 hover:bg-[#faf8f5] transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
                <Icon size={20} className="text-[#5c7f63]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#2d2926]">{label}</p>
                <p className="text-xs text-[#7a6f65]">{sub}</p>
              </div>
              <ChevronRight size={16} className="text-[#c8bfb5] shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
