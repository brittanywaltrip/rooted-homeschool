"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { canExport } from "@/lib/user-access";
import ExportGateModal from "@/app/components/ExportGateModal";
import { IDCardPDF, type IDCardData } from "./IDCardPDF";
import {
  generateBarcodeDataUrl,
  generateIdNumber,
  getCurrentSchoolYear,
  getInitials,
} from "./idCardUtils";

/* IDCardGenerator. Self-contained UI surface for student + educator
 * homeschool ID cards. Replaces the canvas-based IDCardEditor flow that
 * lived in printables/page.tsx. Fetches its own profile + children +
 * subscription state; owns the export gate modal so the parent doesn't
 * need to wire anything beyond <IDCardGenerator />.
 *
 * Photos: not supported (no per-child photo column in the schema).
 * Cards always render initials in the photo circle. */

type Profile = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  is_pro: boolean | null;
  trial_started_at: string | null;
};

type Child = {
  id: string;
  name: string;
  sort_order: number | null;
};

type Tab = "students" | "educator";

function deriveFamilyName(p: Profile | null): string {
  if (!p) return "Family";
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = p.first_name?.trim();
  if (fn) return `${fn} Family`;
  return "Family";
}

function deriveAcademyName(p: Profile | null): string {
  const family = deriveFamilyName(p);
  // Cap at 25 chars per the spec; truncate with ellipsis.
  const candidate = `${family} Academy`;
  return candidate.length > 25 ? `${candidate.slice(0, 22)}...` : candidate;
}

function deriveEducatorName(p: Profile | null): string {
  if (!p) return "Educator";
  const fn = p.first_name?.trim();
  const ln = p.last_name?.trim();
  if (fn && ln) return `${fn} ${ln}`;
  if (fn) return fn;
  return "Educator";
}

export default function IDCardGenerator() {
  const { effectiveUserId } = usePartner();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [tab, setTab] = useState<Tab>("students");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showGate, setShowGate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const [{ data: prof }, { data: kids }] = await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, first_name, last_name, is_pro, trial_started_at")
          .eq("id", effectiveUserId)
          .maybeSingle(),
        supabase
          .from("children")
          .select("id, name, sort_order")
          .eq("user_id", effectiveUserId)
          .eq("archived", false)
          .order("sort_order"),
      ]);
      if (cancelled) return;
      setProfile((prof as Profile | null) ?? null);
      setChildren(((kids as Child[] | null) ?? []));
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId]);

  const academyName = useMemo(() => deriveAcademyName(profile), [profile]);
  const educatorName = useMemo(() => deriveEducatorName(profile), [profile]);
  const schoolYear = useMemo(() => getCurrentSchoolYear(), []);
  const allowed = profile ? canExport({ is_pro: profile.is_pro ?? false, trial_started_at: profile.trial_started_at ?? null }) : false;

  async function handleDownload(args: {
    seedId: string;
    name: string;
    role: "Student" | "Educator";
    gradeOrLabel?: string;
  }) {
    if (!allowed) {
      setShowGate(true);
      return;
    }
    setDownloadingId(args.seedId);
    setError(null);
    try {
      const idNumber = generateIdNumber(args.seedId);
      const barcodeDataUrl = generateBarcodeDataUrl(idNumber);
      const data: IDCardData = {
        name: args.name,
        role: args.role,
        gradeOrLabel: args.gradeOrLabel,
        schoolName: academyName,
        year: schoolYear,
        photoDataUrl: null,
        initials: getInitials(args.name),
        idNumber,
        barcodeDataUrl,
      };
      const { pdf } = await import("@react-pdf/renderer");
      const blob = await pdf(<IDCardPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rooted-ID-${args.name.replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[IDCardGenerator] PDF generation failed", e);
      setError("Couldn't generate the ID card, please try again.");
    } finally {
      setDownloadingId(null);
    }
  }

  const studentRows = children.map((c) => ({
    seedId: c.id,
    name: c.name,
    role: "Student" as const,
    gradeOrLabel: undefined as string | undefined,
  }));
  const educatorRow = effectiveUserId
    ? {
        seedId: effectiveUserId,
        name: educatorName,
        role: "Educator" as const,
        gradeOrLabel: "Homeschool Educator",
      }
    : null;

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("students")}
          aria-pressed={tab === "students"}
          className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
            tab === "students"
              ? "bg-[#2D5A3D] text-white"
              : "bg-white border border-[#e8e2d9] text-[#5C5346] hover:bg-[#faf8f4]"
          }`}
        >
          Student Cards{children.length > 0 ? ` (${children.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setTab("educator")}
          aria-pressed={tab === "educator"}
          className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
            tab === "educator"
              ? "bg-[#2D5A3D] text-white"
              : "bg-white border border-[#e8e2d9] text-[#5C5346] hover:bg-[#faf8f4]"
          }`}
        >
          Educator Card
        </button>
      </div>

      {/* Card list */}
      {tab === "students" ? (
        <div className="space-y-2">
          {studentRows.length === 0 ? (
            <p className="text-sm text-[#b5aca4] italic px-1">
              Add children in Settings to generate their student ID cards.
            </p>
          ) : (
            studentRows.map((row) => (
              <CardRow
                key={row.seedId}
                title={row.name}
                subtitle={`Student · ${academyName}`}
                downloading={downloadingId === row.seedId}
                onDownload={() => handleDownload(row)}
              />
            ))
          )}
        </div>
      ) : (
        <div>
          {educatorRow ? (
            <CardRow
              title={educatorRow.name}
              subtitle={`Homeschool Educator · ${academyName}`}
              downloading={downloadingId === educatorRow.seedId}
              onDownload={() => handleDownload(educatorRow)}
            />
          ) : (
            <p className="text-sm text-[#b5aca4] italic px-1">Sign in to download your educator card.</p>
          )}
        </div>
      )}

      {error ? (
        <p className="text-[12px] text-red-600 italic">{error}</p>
      ) : null}

      {showGate ? (
        <ExportGateModal
          title="Download a clean ID card"
          body="Founding Family unlocks downloadable ID cards for every kid plus your educator card."
          cta="Get My Cards"
          onClose={() => setShowGate(false)}
        />
      ) : null}
    </div>
  );
}

function CardRow({
  title, subtitle, downloading, onDownload,
}: {
  title: string;
  subtitle: string;
  downloading: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#e8e2d9] bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-[#2d2926] truncate">{title}</p>
        <p className="text-[11px] text-[#7a6f65] mt-0.5 truncate">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-[#2D5A3D] hover:bg-[#244830] disabled:opacity-60 disabled:cursor-not-allowed rounded-full px-3.5 py-1.5 transition-colors"
      >
        <Download size={13} /> {downloading ? "Generating..." : "Download ID Card"}
      </button>
    </div>
  );
}
