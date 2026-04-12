"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import { AWARD_META } from "@/lib/certificate-templates";

// ─── Types ─────────────────────────────────────────────────────────────────

type StyleId = "garden" | "heritage" | "artisan";

interface CardFields {
  schoolName: string;
  name: string;
  title: string;
  schoolYear: string;
  state: string;
  showWatermark: boolean;
}

interface ChildData {
  id: string;
  name: string;
  leaves: number;
  streak: number;
}

interface BackFields {
  include: boolean;
  address: string;
  websiteOrEmail: string;
  note: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function currentYearRange(): string {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() < 7 ? `${y - 1}\u2013${y}` : `${y}\u2013${y + 1}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function makeParentDefaults(familyName: string, state: string): CardFields {
  return {
    schoolName: familyName ? `${familyName} Academy` : "Family Academy",
    name: "",
    title: "Homeschool Administrator",
    schoolYear: currentYearRange(),
    state: state || "",
    showWatermark: true,
  };
}

function makeChildDefaults(childName: string, familyName: string, state: string): CardFields {
  return {
    schoolName: familyName ? `${familyName} Academy` : "Family Academy",
    name: childName,
    title: "Student",
    schoolYear: currentYearRange(),
    state: state || "",
    showWatermark: true,
  };
}

const GRADES = [
  "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade",
  "5th Grade", "6th Grade", "7th Grade", "8th Grade", "9th Grade",
  "10th Grade", "11th Grade", "12th Grade",
];

// ─── Style selector data ─────────────────────────────────────────────────────

const STYLES: { id: StyleId; name: string; emoji: string; desc: string }[] = [
  { id: "garden",   name: "The Garden",   emoji: "\uD83C\uDF3F", desc: "Warm cream, botanical leaves, gold accents" },
  { id: "heritage", name: "The Heritage", emoji: "\uD83C\uDFDB\uFE0F", desc: "Formal, triple border, diamond ornaments" },
  { id: "artisan",  name: "The Artisan",  emoji: "\u2726",       desc: "Minimal, editorial, terracotta accent" },
];

// ─── Card preview (live React component, pixel-scaled) ────────────────────

const BW = 252;
const BH = 144;

const PHOTO_BASE_W = 72;
const PHOTO_BASE_H = 90;
const PHOTO_BASE_L = 8;
const PHOTO_BASE_T = Math.round((BH - PHOTO_BASE_H) / 2);

function CardPreview({
  style, fields, photoUrl, scale = 1,
}: {
  style: StyleId; fields: CardFields; photoUrl?: string | null; scale?: number;
}) {
  const W = Math.round(BW * scale);
  const H = Math.round(BH * scale);
  const s = (n: number) => Math.round(n * scale);
  const showSlot = photoUrl !== undefined;

  const photoSlot = showSlot ? (
    <div style={{
      flexShrink: 0,
      width: s(PHOTO_BASE_W), height: s(PHOTO_BASE_H),
      marginTop: s(PHOTO_BASE_T), marginBottom: s(PHOTO_BASE_T),
      marginLeft: s(PHOTO_BASE_L), marginRight: s(6),
      border: photoUrl ? "none" : `${s(1)}px dashed #c4bfb8`,
      borderRadius: s(2), overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: photoUrl ? "transparent" : "#f5f3ef",
      alignSelf: "center",
    }}>
      {photoUrl
        ? <img src={photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} alt="ID photo" />
        : <span style={{ fontSize: s(12), opacity: 0.35 }}>📷</span>
      }
    </div>
  ) : null;

  const base: React.CSSProperties = {
    width: W, height: H, boxSizing: "border-box", overflow: "hidden", flexShrink: 0,
  };

  // Garden style
  if (style === "garden") {
    return (
      <div style={{
        ...base, backgroundColor: "#F7F3E9",
        border: `${s(2)}px solid #2D5016`,
        position: "relative", fontFamily: "'Playfair Display', Georgia, serif",
        display: "flex", flexDirection: "row", alignItems: "center",
      }}>
        <div style={{ position: "absolute", inset: s(5), border: `${s(1)}px solid #C4962A`, pointerEvents: "none" }} />
        {photoSlot}
        <div style={{ flex: 1, zIndex: 1, lineHeight: 1.4, paddingRight: s(showSlot ? 10 : 14), paddingLeft: showSlot ? 0 : s(14), textAlign: showSlot ? "left" : "center" }}>
          <p style={{ fontSize: s(7.5), color: "#C4962A", letterSpacing: s(0.8), textTransform: "uppercase", margin: `0 0 ${s(3)}px` }}>
            {fields.schoolName || "Family Academy"}
          </p>
          <p style={{ fontSize: s(11), fontWeight: "bold", color: "#2d2926", margin: `0 0 ${s(1)}px`, lineHeight: 1.2 }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7), color: "#7a6f65", fontStyle: "italic", margin: `0 0 ${s(4)}px` }}>
            {fields.title}
          </p>
          <div style={{ width: s(showSlot ? 36 : 44), height: 1, backgroundColor: "#C4962A", margin: `0 ${showSlot ? "0" : "auto"} ${s(4)}px` }} />
          <p style={{ fontSize: s(6.5), color: "#7a6f65", margin: 0 }}>
            {[fields.state, fields.schoolYear].filter(Boolean).join(" | ")}
          </p>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5), color: "#c8b898", margin: `${s(3)}px 0 0` }}>Made with Rooted</p>
          )}
        </div>
      </div>
    );
  }

  // Heritage style
  if (style === "heritage") {
    return (
      <div style={{
        ...base, backgroundColor: "#FFFEF7",
        border: `${s(2)}px solid #1A3A2A`,
        position: "relative", fontFamily: "'Playfair Display', Georgia, serif",
        display: "flex", flexDirection: "row", alignItems: "center",
      }}>
        <div style={{ position: "absolute", inset: s(5), border: `${s(0.5)}px solid #B8860B`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: s(8), border: `${s(1)}px solid #1A3A2A`, pointerEvents: "none" }} />
        {photoSlot}
        <div style={{ flex: 1, zIndex: 1, lineHeight: 1.4, paddingRight: s(showSlot ? 10 : 14), paddingLeft: showSlot ? 0 : s(14), textAlign: showSlot ? "left" : "center" }}>
          <p style={{ fontSize: s(7.5), color: "#1A3A2A", letterSpacing: s(0.8), fontVariant: "small-caps", margin: `0 0 ${s(3)}px` }}>
            {fields.schoolName || "Family Academy"}
          </p>
          <p style={{ fontSize: s(11), fontWeight: "bold", color: "#0a1a0a", margin: `0 0 ${s(1)}px`, lineHeight: 1.2, fontStyle: "italic" }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7), color: "#7a6f65", fontStyle: "italic", margin: `0 0 ${s(4)}px` }}>
            {fields.title}
          </p>
          <div style={{ width: s(showSlot ? 36 : 44), height: 1, backgroundColor: "#B8860B", margin: `0 ${showSlot ? "0" : "auto"} ${s(4)}px` }} />
          <p style={{ fontSize: s(6.5), color: "#7a6f65", margin: 0 }}>
            {[fields.state, fields.schoolYear].filter(Boolean).join(" | ")}
          </p>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5), color: "#b8a888", margin: `${s(3)}px 0 0` }}>Made with Rooted</p>
          )}
        </div>
      </div>
    );
  }

  // Artisan style
  return (
    <div style={{
      ...base, backgroundColor: "#FAFAF8",
      display: "flex", flexDirection: "row",
      fontFamily: "'Cormorant Garamond', Georgia, serif",
      overflow: "hidden",
    }}>
      <div style={{ width: s(6), backgroundColor: "#C4613A", flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: s(2), backgroundColor: "#C4613A" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "row", alignItems: "center" }}>
          {photoSlot}
          <div style={{ flex: 1, padding: `${s(6)}px ${s(8)}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <p style={{ fontSize: s(6), color: "#C4613A", letterSpacing: s(1), textTransform: "uppercase", fontFamily: "'Jost', sans-serif", fontWeight: 300, margin: `0 0 ${s(2)}px` }}>
              {fields.schoolName || "Family Academy"}
            </p>
            <p style={{ fontSize: s(showSlot ? 12 : 14), fontStyle: "italic", color: "#2C2520", margin: `0 0 ${s(2)}px`, lineHeight: 1.2 }}>
              {fields.name || "Your Name"}
            </p>
            <p style={{ fontSize: s(7), color: "#7a6a5e", fontStyle: "italic", margin: `0 0 ${s(4)}px` }}>
              {fields.title}
            </p>
            <p style={{ fontSize: s(6.5), color: "#b5aca4", margin: 0 }}>
              {[fields.state, fields.schoolYear].filter(Boolean).join(" | ")}
            </p>
            {fields.showWatermark && (
              <p style={{ fontSize: s(5), color: "#c0b8b0", margin: `${s(3)}px 0 0` }}>Made with Rooted</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card PDF download via canvas ─────────────────────────────────────────────

async function downloadIdCard(
  style: StyleId,
  fields: CardFields,
  photoUrl: string | null,
  label: string,
  back?: BackFields,
) {
  const { drawIdCardPDF } = await import("@/lib/certificate-canvas");
  await drawIdCardPDF(style, {
    schoolName: fields.schoolName, name: fields.name, title: fields.title,
    schoolYear: fields.schoolYear, state: fields.state, showWatermark: fields.showWatermark,
    photoDataUrl: photoUrl,
    back: back?.include ? back : undefined,
  }, label);
}

async function downloadIdPrintSheet(
  style: StyleId,
  fields: CardFields,
  photoUrl: string | null,
  back?: BackFields,
) {
  const { drawIdCardPrintSheetPDF } = await import("@/lib/certificate-canvas");
  await drawIdCardPrintSheetPDF(style, {
    schoolName: fields.schoolName, name: fields.name, title: fields.title,
    schoolYear: fields.schoolYear, state: fields.state, showWatermark: fields.showWatermark,
    photoDataUrl: photoUrl,
    back: back?.include ? back : undefined,
  });
}

// ─── Shared form components ──────────────────────────────────────────────────

function FieldInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]" />
    </div>
  );
}

function TextAreaInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <textarea value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows={2}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63] resize-none" />
    </div>
  );
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function ChildSelect({ childrenList, value, onChange }: {
  childrenList: ChildData[];
  value: string;
  onChange: (childId: string, childName: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">Child</label>
      <select value={value} onChange={e => {
        const child = childrenList.find(c => c.id === e.target.value);
        onChange(e.target.value, child?.name || "");
      }}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]">
        {childrenList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

// ─── Photo upload ────────────────────────────────────────────────────────────

function PhotoUpload({ photoUrl, onChange }: {
  photoUrl: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.type.match(/^image\/(jpeg|png)$/)) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const targetRatio = 4 / 5;
        let cropW = img.width, cropH = img.height, cropX = 0, cropY = 0;
        if (img.width / img.height > targetRatio) {
          cropW = img.height * targetRatio; cropX = (img.width - cropW) / 2;
        } else {
          cropH = img.width / targetRatio; cropY = 0;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(cropW); canvas.height = Math.round(cropH);
        canvas.getContext("2d")!.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
        onChange(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-2">
        Photo <span className="text-red-400 font-bold">*</span>
      </label>
      <div className="flex gap-4 items-start">
        <div onClick={() => !photoUrl && inputRef.current?.click()}
          className={`relative flex-shrink-0 overflow-hidden rounded border-2 flex items-center justify-center transition-colors ${
            photoUrl ? "border-[#e8e2d9] w-[72px] h-[90px]" : "border-dashed border-[#5c7f63] w-[72px] h-[90px] cursor-pointer hover:border-[var(--g-deep)] hover:bg-[#f0f7f1]"
          }`} style={{ background: photoUrl ? undefined : "#fafef8" }}>
          {photoUrl ? (
            <img src={photoUrl} className="w-full h-full object-cover object-top" alt="ID photo" />
          ) : (
            <div className="text-center px-1">
              <p className="text-2xl leading-tight">📷</p>
              <p className="text-[9px] text-[#5c7f63] font-semibold mt-1 leading-tight">Upload photo</p>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 pt-1">
          {!photoUrl ? (
            <button type="button" onClick={() => inputRef.current?.click()}
              className="text-sm font-semibold text-white bg-[#5c7f63] hover:bg-[var(--g-deep)] px-3 py-1.5 rounded-lg transition-colors">
              📷 Upload photo
            </button>
          ) : (
            <div className="flex gap-3">
              <button type="button" onClick={() => inputRef.current?.click()} className="text-xs font-semibold text-[#5c7f63] hover:underline">Change</button>
              <button type="button" onClick={() => onChange(null)} className="text-xs text-[#b5aca4] hover:text-red-400 hover:underline">Remove</button>
            </div>
          )}
          <p className="text-[11px] text-[#2d2926] font-medium mt-2 leading-relaxed">Photo required — most programs require a photo ID to be valid.</p>
          <p className="text-[10px] text-[#b5aca4] mt-0.5">JPG or PNG, auto-cropped to portrait</p>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ─── ID card editor ──────────────────────────────────────────────────────────

function IDCardEditor({
  style, fields, onChange, cardLabel,
}: {
  style: StyleId; fields: CardFields; onChange: (f: CardFields) => void; cardLabel: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadingSheet, setDownloadingSheet] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [back, setBack] = useState<BackFields>({ include: false, address: "", websiteOrEmail: "", note: "" });

  const set = (key: keyof CardFields, val: string | boolean) => onChange({ ...fields, [key]: val });
  const setBackField = (key: keyof BackFields, val: string | boolean) => setBack(prev => ({ ...prev, [key]: val }));
  const canDownload = !!photoUrl;

  async function handleDownload() {
    if (!photoUrl) return;
    setDownloading(true);
    try { await downloadIdCard(style, fields, photoUrl, cardLabel, back); }
    catch (e) { console.error(e); alert("Download failed. Please try again."); }
    finally { setDownloading(false); }
  }

  async function handlePrintSheet() {
    if (!photoUrl) return;
    setDownloadingSheet(true);
    try { await downloadIdPrintSheet(style, fields, photoUrl, back); }
    catch (e) { console.error(e); alert("Download failed. Please try again."); }
    finally { setDownloadingSheet(false); }
  }

  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#f0ede8] flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-[#2d2926] pt-0.5">{cardLabel}</h3>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} disabled={!canDownload || downloading}
              title={!photoUrl ? "Upload a photo to enable download" : undefined}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors">
              <Download size={11} /> {downloading ? "Generating\u2026" : "Download ID Card"}
            </button>
            <button onClick={handlePrintSheet} disabled={!canDownload || downloadingSheet}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors">
              <span className="text-[11px]">📄</span> {downloadingSheet ? "Generating\u2026" : "Print Sheet"}
            </button>
          </div>
          {!photoUrl && <p className="text-[10px] text-[#b5aca4]">Upload a photo to enable download</p>}
          {photoUrl && (
            <p className="text-[10px] text-[#b5aca4] text-right max-w-xs leading-relaxed">
              💡 Print at 100% (do not scale to fit). Cut on the crop marks. Print on cardstock and laminate.
            </p>
          )}
        </div>
      </div>
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <PhotoUpload photoUrl={photoUrl} onChange={setPhotoUrl} />
          <FieldInput label="School Name" value={fields.schoolName} onChange={v => set("schoolName", v)} />
          <FieldInput label={cardLabel.toLowerCase().includes("student") ? "Student Name" : "Parent Name"} value={fields.name} onChange={v => set("name", v)} />
          <FieldInput label="Title" value={fields.title} onChange={v => set("title", v)} />
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="School Year" value={fields.schoolYear} onChange={v => set("schoolYear", v)} />
            <FieldInput label="State" value={fields.state} onChange={v => set("state", v)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={fields.showWatermark} onChange={e => set("showWatermark", e.target.checked)} className="w-4 h-4 rounded accent-[#5c7f63]" />
            <span className="text-xs text-[#7a6f65]">Include &ldquo;Made with Rooted&rdquo; on card</span>
          </label>
          <div className="border-t border-[#f0ede8] pt-3 mt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={back.include} onChange={e => setBackField("include", e.target.checked)} className="w-4 h-4 rounded accent-[#5c7f63]" />
              <span className="text-xs font-semibold text-[#2d2926]">Include card back (double-sided)</span>
            </label>
          </div>
          {back.include && (
            <div className="space-y-2.5 pl-1">
              <FieldInput label="School Address (optional)" value={back.address} onChange={v => setBackField("address", v)} />
              <FieldInput label="Website or Email (optional)" value={back.websiteOrEmail} onChange={v => setBackField("websiteOrEmail", v)} />
              <FieldInput label="Note (optional)" value={back.note} onChange={v => setBackField("note", v)} />
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-wide">Front</p>
            <div className="shadow-lg rounded overflow-hidden">
              <CardPreview style={style} fields={fields} photoUrl={photoUrl} scale={1.55} />
            </div>
            <p className="text-[10px] text-[#b5aca4]">3.5&Prime; &times; 2&Prime;</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Certificate download via Canvas 2D + jsPDF ─────────────────────────────

async function downloadCertificate(type: string, style: StyleId, data: Record<string, string>, filename?: string) {
  const { drawCertificatePDF } = await import("@/lib/certificate-canvas");
  await drawCertificatePDF(type, style, data, filename);
}

// ─── Award card component ────────────────────────────────────────────────────

function AwardCard({
  awardType, childName, style, onDownload, downloading,
}: {
  awardType: string;
  childName?: string;
  style: StyleId;
  onDownload: (note: string, date: string) => void;
  downloading: boolean;
}) {
  const meta = AWARD_META[awardType as keyof typeof AWARD_META];
  if (!meta) return null;
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayStr());

  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-4 space-y-2 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#2d2926] truncate">{meta.label}</p>
          <p className="text-[11px] text-[#b5aca4] mt-0.5">
            {meta.isEducator ? "For you" : childName || ""}
          </p>
        </div>
        <button onClick={() => onDownload(note, date)} disabled={downloading}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5c7f63] hover:text-[var(--g-deep)] disabled:opacity-50 shrink-0 mt-0.5">
          {downloading ? (
            <span className="inline-block w-3 h-3 border-2 border-[#5c7f63] border-t-transparent rounded-full animate-spin" />
          ) : (
            <Download size={12} />
          )}
          {downloading ? "Generating\u2026" : "Download"}
        </button>
      </div>
      <div className="flex gap-2 items-center">
        <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Personal note (optional)"
          className="flex-1 min-w-0 border border-[#e8e2d9] rounded-lg px-2 py-1 text-[11px] text-[#2d2926] bg-[#fefcf9] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63]" />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="w-[120px] shrink-0 border border-[#e8e2d9] rounded-lg px-2 py-1 text-[11px] text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63]" />
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PrintablesPage() {
  const partnerCtx = usePartner();
  const [activeStyle, setActiveStyle] = useState<StyleId>("garden");
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [children, setChildren] = useState<ChildData[]>([]);
  const [parentFields, setParentFields] = useState<CardFields | null>(null);
  const [childFields, setChildFields] = useState<Record<string, CardFields>>({});
  // Award states
  const [downloadingAward, setDownloadingAward] = useState<string | null>(null);

  // Custom certificate
  const [customName, setCustomName] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customText, setCustomText] = useState("");
  const [customAcademy, setCustomAcademy] = useState("");
  const [customDate, setCustomDate] = useState(todayStr());
  const [customDownloading, setCustomDownloading] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Manual award states
  const [gradChild, setGradChild] = useState("");
  const [gradGrade, setGradGrade] = useState("Kindergarten");
  const [subjectChild, setSubjectChild] = useState("");
  const [subjectName, setSubjectName] = useState("");

  useEffect(() => { document.title = "Printables — Rooted"; localStorage.setItem("rooted_visited_printables", "1"); }, []);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = partnerCtx.effectiveUserId || session.user.id;

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, state, is_pro, printable_style")
        .eq("id", uid)
        .maybeSingle();

      const fName = (profile as Record<string, string> | null)?.display_name || "";
      const st = (profile as Record<string, string> | null)?.state || "";
      const savedStyle = (profile as Record<string, string> | null)?.printable_style;
      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
      setFamilyName(fName);
      setStateCode(st);
      setParentFields(makeParentDefaults(fName, st));
      setCustomAcademy(fName ? `${fName} Academy` : "Family Academy");
      if (savedStyle && ["garden", "heritage", "artisan"].includes(savedStyle)) {
        setActiveStyle(savedStyle as StyleId);
      }

      const { data: kids } = await supabase
        .from("children").select("id, name").eq("user_id", uid).eq("archived", false).order("sort_order");

      const [{ data: completedLessons }, { data: bookEvents }] = await Promise.all([
        supabase.from("lessons").select("child_id, date").eq("user_id", uid).eq("completed", true),
        supabase.from("app_events").select("payload").eq("user_id", uid).eq("type", "book_read"),
      ]);

      const leafMap: Record<string, number> = {};
      for (const l of (completedLessons || []) as { child_id: string }[]) leafMap[l.child_id] = (leafMap[l.child_id] || 0) + 1;
      for (const e of (bookEvents || []) as { payload: { child_id?: string } }[]) {
        const cid = e.payload?.child_id;
        if (cid) leafMap[cid] = (leafMap[cid] || 0) + 1;
      }

      const childDatesMap: Record<string, Set<string>> = {};
      for (const l of (completedLessons || []) as { child_id: string; date?: string }[]) {
        if (!l.date) continue;
        if (!childDatesMap[l.child_id]) childDatesMap[l.child_id] = new Set();
        childDatesMap[l.child_id].add(l.date);
      }

      function computeStreak(dates: Set<string>): number {
        let streak = 0;
        const ds = (d: Date) => d.toISOString().slice(0, 10);
        const tmp = new Date(); tmp.setHours(0, 0, 0, 0);
        const c2 = new Date(tmp);
        while (dates.has(ds(c2))) { streak++; c2.setDate(c2.getDate() - 1); }
        if (streak === 0) { tmp.setDate(tmp.getDate() - 1); while (dates.has(ds(tmp))) { streak++; tmp.setDate(tmp.getDate() - 1); } }
        return streak;
      }

      const kidsArr: ChildData[] = (kids || []).map((k: { id: string; name: string }) => ({
        id: k.id, name: k.name,
        leaves: leafMap[k.id] || 0,
        streak: computeStreak(childDatesMap[k.id] || new Set()),
      }));
      setChildren(kidsArr);
      if (kidsArr[0]) { setGradChild(kidsArr[0].id); setSubjectChild(kidsArr[0].id); }

      const cardMap: Record<string, CardFields> = {};
      for (const kid of kidsArr) cardMap[kid.id] = makeChildDefaults(kid.name, fName, st);
      setChildFields(cardMap);

      // (Awards are shown from full catalog, no earned_awards check needed)
    }
    load();
  }, [partnerCtx.effectiveUserId]);

  const updateChildField = useCallback((id: string, f: CardFields) => {
    setChildFields(prev => ({ ...prev, [id]: f }));
  }, []);

  async function saveStylePref(s: StyleId) {
    setActiveStyle(s);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.from("profiles").update({ printable_style: s }).eq("id", session.user.id);
    }
  }

  async function handleCatalogDownload(awardType: string, recipientName: string, isEducator: boolean, note: string, date: string) {
    const key = `${awardType}-${recipientName}`;
    setDownloadingAward(key);
    try {
      const data: Record<string, string> = {
        academyName: schoolName,
        schoolYear: currentYearRange(),
        date,
      };
      if (isEducator) {
        data.educatorName = familyName || "Educator";
      } else {
        data.childName = recipientName;
      }
      if (note) data.note = note;
      await downloadCertificate(awardType, activeStyle, data);
    } catch (e) { console.error(e); showError(e); }
    finally { setDownloadingAward(null); }
  }

  async function handleCustomDownload() {
    if (!customName.trim()) return;
    setCustomDownloading(true);
    try {
      await downloadCertificate("custom", activeStyle, {
        recipientName: customName, awardTitle: customTitle || "Certificate of Achievement",
        awardText: customText, academyName: customAcademy, date: customDate,
      });
    } catch (e) { console.error(e); showError(e); }
    finally { setCustomDownloading(false); }
  }

  async function handleManualGraduation() {
    const child = children.find(c => c.id === gradChild);
    if (!child) return;
    setDownloadingAward("manual-grad");
    try {
      const data = {
        childName: child.name, grade: gradGrade,
        academyName: familyName ? `${familyName} Academy` : "Family Academy",
        schoolYear: currentYearRange(), date: todayStr(),
      };
      await downloadCertificate("graduation", activeStyle, data);
    } catch (e) { console.error(e); showError(e); }
    finally { setDownloadingAward(null); }
  }

  async function handleManualSubject() {
    const child = children.find(c => c.id === subjectChild);
    if (!child || !subjectName.trim()) return;
    setDownloadingAward("manual-subject");
    try {
      const data = {
        childName: child.name, subjectName,
        academyName: familyName ? `${familyName} Academy` : "Family Academy",
        schoolYear: currentYearRange(), date: todayStr(),
      };
      await downloadCertificate("subject_mastery", activeStyle, data);
    } catch (e) { console.error(e); showError(e); }
    finally { setDownloadingAward(null); }
  }

  function showError(e: unknown) {
    const msg = e instanceof Error ? e.message : "Download failed — please try again";
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 5000);
  }

  const schoolName = familyName ? `${familyName} Academy` : "Family Academy";
  const sampleFields: CardFields = {
    schoolName, name: "Sample Name", title: "Student",
    schoolYear: currentYearRange(), state: stateCode || "NV", showWatermark: false,
  };

  // Build full catalog — child awards × all children, educator awards once
  const allTypes = Object.keys(AWARD_META).filter(t => t !== "custom" && t !== "graduation" && t !== "subject_mastery");
  const childAwardTypes = allTypes.filter(t => !AWARD_META[t as keyof typeof AWARD_META]?.isEducator);
  const educatorAwardTypes = allTypes.filter(t => AWARD_META[t as keyof typeof AWARD_META]?.isEducator);

  return (
    <>
    <PageHero overline="Your Family's" title="Printables" subtitle="No Canva needed. Your certificates and ID cards — made beautiful automatically." />
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">

      {/* ── Style Picker ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">Your style — applies to all printables</h2>
        <p className="text-xs text-[#b5aca4] mb-4">Choose once, applied everywhere.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STYLES.map((s) => (
            <button key={s.id} onClick={() => saveStylePref(s.id)}
              className={`text-left rounded-xl border-2 p-3 transition-all ${
                activeStyle === s.id
                  ? "border-[#5c7f63] shadow-md shadow-[#5c7f63]/10 bg-[#fefcf9]"
                  : "border-[#e8e2d9] bg-white hover:border-[#c4bfb8]"
              }`}>
              <div className="mb-2.5 rounded overflow-hidden shadow-sm w-fit">
                <CardPreview style={s.id} fields={sampleFields} scale={0.6} />
              </div>
              <p className={`text-xs font-bold leading-tight ${activeStyle === s.id ? "text-[var(--g-deep)]" : "text-[#2d2926]"}`}>
                {s.emoji} {s.name}
              </p>
              <p className="text-[10px] text-[#b5aca4] mt-0.5">{s.desc}</p>
              {activeStyle === s.id && (
                <span className="inline-block mt-1.5 text-[9px] font-bold text-[#5c7f63] bg-[#e8f0e9] px-1.5 py-0.5 rounded-full">
                  Selected ✓
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ── Your Certificates (child awards) ─────────────────────── */}
      {children.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-[#2d2926] mb-0.5">🎓 Your Certificates</h2>
          <p className="text-xs text-[#b5aca4] mb-4">Download and print any time. Gift them when the moment is right.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {children.flatMap(child =>
              childAwardTypes.map(t => (
                <AwardCard key={`${t}-${child.id}`} awardType={t} childName={child.name} style={activeStyle}
                  onDownload={(note, date) => handleCatalogDownload(t, child.name, false, note, date)}
                  downloading={downloadingAward === `${t}-${child.name}`} />
              ))
            )}
          </div>
        </section>
      )}

      {/* ── For the Educator ──────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">💛 For the Educator</h2>
        <p className="text-xs text-[#b5aca4] mb-4">You&apos;re doing the hardest part.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {educatorAwardTypes.map(t => (
            <AwardCard key={t} awardType={t} style={activeStyle}
              onDownload={(note, date) => handleCatalogDownload(t, familyName || "Educator", true, note, date)}
              downloading={downloadingAward === `${t}-${familyName || "Educator"}`} />
          ))}
        </div>
      </section>

      {/* ── Graduation & Subject (manual) ─────────────────────────── */}
      {children.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-[#2d2926] mb-0.5">🎓 Graduation & Subject Completion</h2>
          <p className="text-xs text-[#b5aca4] mb-4">Create these when your child finishes a grade or subject.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Graduation */}
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
              <p className="text-sm font-bold text-[#2d2926]">🎓 Graduation Certificate</p>
              <ChildSelect childrenList={children} value={gradChild} onChange={(id) => setGradChild(id)} />
              <SelectInput label="Grade Level" value={gradGrade} options={GRADES} onChange={setGradGrade} />
              <button onClick={handleManualGraduation} disabled={downloadingAward === "manual-grad"}
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
                <Download size={12} /> {downloadingAward === "manual-grad" ? "Generating\u2026" : "Download Certificate"}
              </button>
            </div>
            {/* Subject */}
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
              <p className="text-sm font-bold text-[#2d2926]">📚 Subject Completion</p>
              <ChildSelect childrenList={children} value={subjectChild} onChange={(id) => setSubjectChild(id)} />
              <FieldInput label="Subject Name" value={subjectName} onChange={setSubjectName} placeholder="e.g. Math, Reading" />
              <button onClick={handleManualSubject} disabled={downloadingAward === "manual-subject" || !subjectName.trim()}
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
                <Download size={12} /> {downloadingAward === "manual-subject" ? "Generating\u2026" : "Download Certificate"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Custom Certificate ─────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">🌟 Custom Certificate</h2>
        <p className="text-xs text-[#b5aca4] mb-4">For the moments that don&apos;t fit a box.</p>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldInput label="Recipient Name" value={customName} onChange={setCustomName} placeholder="e.g. Emma" />
            <FieldInput label="Award Title" value={customTitle} onChange={setCustomTitle} placeholder="e.g. Certificate of Achievement" />
          </div>
          <TextAreaInput label="What they accomplished" value={customText} onChange={setCustomText} placeholder="Write what makes this special..." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FieldInput label="Academy Name" value={customAcademy} onChange={setCustomAcademy} />
            <div>
              <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">Date</label>
              <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
                className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]" />
            </div>
          </div>
          <button onClick={handleCustomDownload} disabled={customDownloading || !customName.trim()}
            className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
            <Download size={12} /> {customDownloading ? "Generating\u2026" : "Download Certificate"}
          </button>
        </div>
      </section>


      {/* ── ID Cards ─────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-[#2d2926]">🪪 Homeschool ID Cards</h2>
          <p className="text-xs text-[#b5aca4] mt-1 max-w-2xl leading-relaxed">
            Auto-filled from your profile. Most programs require a photo.
          </p>
        </div>

        {parentFields ? (
          <IDCardEditor style={activeStyle} fields={parentFields} onChange={setParentFields} cardLabel="Parent Homeschool Administrator ID" />
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-6 py-8 flex items-center justify-center">
            <span className="text-2xl animate-pulse">🌿</span>
          </div>
        )}

        {children.map(child => {
          const fields = childFields[child.id];
          if (!fields) return null;
          return (
            <IDCardEditor key={child.id} style={activeStyle} fields={fields}
              onChange={(f) => updateChildField(child.id, f)}
              cardLabel={`${child.name}'s Student ID`} />
          );
        })}

        {parentFields && children.length === 0 && (
          <p className="text-sm text-[#b5aca4] italic px-1">Add children in Settings to generate their student ID cards.</p>
        )}
      </section>

      {/* Error toast */}
      {errorToast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[70]">
          <button onClick={() => setErrorToast(null)}
            className="bg-red-600 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-lg whitespace-nowrap">
            {errorToast}
          </button>
        </div>
      )}

    </div>
    </>
  );
}
