"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GraduationCap, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import PageHero from "@/app/components/PageHero";

type Child = { id: string; name: string; color: string | null };
type SettingsRow = { child_id: string };

export default function TranscriptHubPage() {
  const router = useRouter();
  const [children, setChildren] = useState<Child[]>([]);
  const [settingsMap, setSettingsMap] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Transcripts · Rooted";
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: kids }, { data: settings }] = await Promise.all([
        supabase.from("children").select("id, name, color").eq("user_id", user.id).eq("archived", false).order("sort_order"),
        supabase.from("transcript_settings").select("child_id").eq("user_id", user.id),
      ]);

      const childList = (kids ?? []) as Child[];
      setChildren(childList);
      setSettingsMap(new Set((settings as SettingsRow[] ?? []).map(s => s.child_id)));

      // Auto-navigate if only one child
      if (childList.length === 1) {
        router.replace(`/dashboard/transcript/${childList[0].id}`);
        return;
      }

      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return (
      <>
        <PageHero overline="Transcripts" title="Grades & Transcripts" subtitle="Track courses, calculate GPA, and build official transcripts for your kids." />
        <div className="max-w-xl mx-auto px-5 pt-6">
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="bg-white rounded-2xl p-5 animate-pulse" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#e8e2d9]" />
                  <div className="flex-1 space-y-2">
                    <div className="w-24 h-4 rounded bg-[#e8e2d9]" />
                    <div className="w-32 h-3 rounded bg-[#e8e2d9]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (children.length === 0) {
    return (
      <>
        <PageHero overline="Transcripts" title="Grades & Transcripts" subtitle="Track courses, calculate GPA, and build official transcripts for your kids." />
        <div className="max-w-xl mx-auto px-5 pt-10">
          <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            <GraduationCap size={40} className="mx-auto mb-3 text-[#c8bfb5]" />
            <p className="text-[15px] font-medium text-[#3c3a37] mb-1">Add your kids first</p>
            <p className="text-[13px] text-[#6b6560] mb-4">
              Head to Settings to add your children, then come back here to set up their transcripts.
            </p>
            <Link href="/dashboard/settings?tab=kids"
              className="inline-block bg-[#2D5A3D] text-white text-[13px] font-medium px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity">
              Go to Settings
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero overline="Transcripts" title="Grades & Transcripts" subtitle="Track courses, calculate GPA, and build official transcripts for your kids." />
      <div className="max-w-xl mx-auto px-5 pt-6 pb-10">
        <div className="space-y-3">
          {children.map(child => {
            const hasSetup = settingsMap.has(child.id);
            return (
              <Link key={child.id} href={`/dashboard/transcript/${child.id}`}
                className="block bg-white rounded-2xl p-5 hover:shadow-md transition-shadow"
                style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
                    style={{ backgroundColor: child.color || "#5c7f63" }}>
                    {child.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium text-[#3c3a37]">{child.name}</p>
                    <p className="text-[12px] text-[#8a8580]">
                      {hasSetup ? "View transcript" : "Set up transcript"}
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-[#c8bfb5] shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
