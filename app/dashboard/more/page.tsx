"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { LogOut, User, Users, Bell, HelpCircle, ChevronRight, Settings } from "lucide-react";

type Profile = { display_name: string | null };

export default function MorePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setEmail(user.email ?? "");
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      setProfile(data);
    });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const menuItems = [
    { icon: Settings,    label: "Settings",             sub: "Family name, children, colors", href: "/dashboard/settings" },
    { icon: User,        label: "Account",              sub: email,                           href: "/dashboard/settings" },
    { icon: Users,       label: "Children",             sub: "Add or edit children",          href: "/dashboard/settings" },
    { icon: Bell,        label: "Notifications",        sub: "Off",                           href: null },
    { icon: HelpCircle,  label: "Help & Feedback",      sub: "support@rootedhomeschool.com",  href: null },
  ];

  return (
    <div className="max-w-2xl px-5 py-7 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Settings
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">More ⚙️</h1>
      </div>

      {/* Profile card */}
      <div className="bg-gradient-to-br from-[#e8f0e9] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[#5c7f63] flex items-center justify-center text-white text-lg font-bold">
          🌿
        </div>
        <div>
          <p className="font-semibold text-[#2d2926]">
            {profile?.display_name || "Your Family"}
          </p>
          <p className="text-sm text-[#7a6f65]">{email}</p>
        </div>
      </div>

      {/* Menu items */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
        {menuItems.map(({ icon: Icon, label, sub, href }) => {
          const inner = (
            <>
              <Icon size={18} className="text-[#7a6f65] shrink-0" strokeWidth={1.8} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#2d2926]">{label}</p>
                {sub && <p className="text-xs text-[#b5aca4] truncate">{sub}</p>}
              </div>
              <ChevronRight size={16} className="text-[#c8bfb5] shrink-0" />
            </>
          );
          return href ? (
            <Link
              key={label}
              href={href}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#f8f5f0] transition-colors text-left"
            >
              {inner}
            </Link>
          ) : (
            <div key={label} className="flex items-center gap-4 px-5 py-4 opacity-60">
              {inner}
            </div>
          );
        })}
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full flex items-center justify-center gap-2 bg-[#fefcf9] border border-[#e8e2d9] hover:border-red-200 hover:bg-red-50 text-[#7a6f65] hover:text-red-600 rounded-2xl px-5 py-3.5 text-sm font-medium transition-colors"
      >
        <LogOut size={16} strokeWidth={1.8} />
        Sign Out
      </button>

      <p className="text-center text-xs text-[#c8bfb5]">
        Rooted Homeschool · Built with ❤️ for learning families
      </p>
    </div>
  );
}
