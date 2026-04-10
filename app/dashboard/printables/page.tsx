"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Download, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { AWARD_META } from "@/lib/certificate-templates";
import type { EarnedAward, NewAward, AppData } from "@/lib/award-unlocks";

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
) {
  const { drawIdCardPDF } = await import("@/lib/certificate-canvas");
  await drawIdCardPDF(style, {
    schoolName: fields.schoolName, name: fields.name, title: fields.title,
    schoolYear: fields.schoolYear, state: fields.state, showWatermark: fields.showWatermark,
    photoDataUrl: photoUrl,
  }, label);
}

async function downloadIdPrintSheet(
  style: StyleId,
  fields: CardFields,
  photoUrl: string | null,
) {
  const { drawIdCardPrintSheetPDF } = await import("@/lib/certificate-canvas");
  await drawIdCardPrintSheetPDF(style, {
    schoolName: fields.schoolName, name: fields.name, title: fields.title,
    schoolYear: fields.schoolYear, state: fields.state, showWatermark: fields.showWatermark,
    photoDataUrl: photoUrl,
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
            photoUrl ? "border-[#e8e2d9] w-[72px] h-[90px]" : "border-dashed border-[#5c7f63] w-[72px] h-[90px] cursor-pointer hover:border-[#3d5c42] hover:bg-[#f0f7f1]"
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
              className="text-sm font-semibold text-white bg-[#5c7f63] hover:bg-[#3d5c42] px-3 py-1.5 rounded-lg transition-colors">
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
    try { await downloadIdCard(style, fields, photoUrl, cardLabel); }
    catch (e) { console.error(e); alert("Download failed. Please try again."); }
    finally { setDownloading(false); }
  }

  async function handlePrintSheet() {
    if (!photoUrl) return;
    setDownloadingSheet(true);
    try { await downloadIdPrintSheet(style, fields, photoUrl); }
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
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors">
              <Download size={11} /> {downloading ? "Generating\u2026" : "Download ID Card"}
            </button>
            <button onClick={handlePrintSheet} disabled={!canDownload || downloadingSheet}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors">
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
          <div className="flex flex-col items-center gap-2 printable-id-front">
            <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-wide no-print">Front</p>
            <div className="shadow-lg rounded overflow-hidden print:shadow-none">
              <CardPreview style={style} fields={fields} photoUrl={photoUrl} scale={1.55} />
            </div>
            <p className="text-[10px] text-[#b5aca4] no-print">3.5&Prime; &times; 2&Prime;</p>
          </div>
          {back.include && (
            <div className="flex flex-col items-center gap-2 printable-id-back">
              <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-wide no-print">Back</p>
              <div className="shadow-lg rounded overflow-hidden print:shadow-none" style={{ width: Math.round(BW * 1.55), height: Math.round(BH * 1.55), backgroundColor: style === "garden" ? "#F7F3E9" : style === "heritage" ? "#FFFEF7" : "#FAFAF8", border: style === "garden" ? "2px solid #2D5016" : style === "heritage" ? "2px solid #1A3A2A" : "none", borderLeft: style === "artisan" ? "6px solid #C4613A" : undefined, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 16px", fontFamily: style === "artisan" ? "'Jost', sans-serif" : "'Playfair Display', Georgia, serif" }}>
                <p style={{ fontSize: 10, fontWeight: "bold", color: style === "artisan" ? "#C4613A" : style === "heritage" ? "#1A3A2A" : "#2D5016", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>{fields.schoolName}</p>
                {back.address && <p style={{ fontSize: 9, color: "#7a6f65", marginBottom: 2 }}>{back.address}</p>}
                {back.websiteOrEmail && <p style={{ fontSize: 9, color: "#7a6f65", marginBottom: 2 }}>{back.websiteOrEmail}</p>}
                {back.note && <p style={{ fontSize: 8, color: "#b5aca4", fontStyle: "italic", marginTop: 6, textAlign: "center" }}>{back.note}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Progress Report ────────────────────────────────────────────────────────

function AnnualReportCard({
  childrenList, schoolName, schoolYear, showWatermark, setShowWatermark,
}: {
  childrenList: ChildData[]; schoolName: string; schoolYear: string;
  showWatermark: boolean; setShowWatermark: (v: boolean) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const { generateProgressReport, fmtMins: fmt } = await import("@/lib/pdf");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setDownloading(false); return; }
      const uid = session.user.id;

      type LR = { child_id: string; title: string; completed: boolean; minutes_spent: number | null; scheduled_date: string | null; date: string | null; curriculum_goal_id: string | null; subjects: { name: string } | null };
      type MR = { child_id: string | null; type: string; title: string | null; date: string; duration_minutes: number | null };
      type GR = { id: string; default_minutes: number };
      type BR = { payload: { badge_name?: string; child_id?: string } };

      const [{ data: lr }, { data: mr }, { data: gr }, { data: br }] = await Promise.all([
        supabase.from("lessons").select("child_id, title, completed, minutes_spent, scheduled_date, date, curriculum_goal_id, subjects(name)").eq("user_id", uid),
        supabase.from("memories").select("child_id, type, title, date, duration_minutes").eq("user_id", uid),
        supabase.from("curriculum_goals").select("id, default_minutes").eq("user_id", uid),
        supabase.from("app_events").select("payload").eq("user_id", uid).eq("type", "badge_earned"),
      ]);

      const lessons = (lr || []) as unknown as LR[];
      const memories = (mr || []) as unknown as MR[];
      const badges = (br || []) as unknown as BR[];
      const gdm: Record<string, number> = {};
      for (const g of ((gr || []) as unknown as GR[])) gdm[g.id] = g.default_minutes ?? 30;

      function lm(l: LR): { m: number; e: boolean } { if (l.minutes_spent != null) return { m: l.minutes_spent, e: false }; if (l.curriculum_goal_id && gdm[l.curriculum_goal_id]) return { m: gdm[l.curriculum_goal_id], e: true }; return { m: 30, e: true }; }
      function ld(l: LR) { return l.scheduled_date || l.date || ""; }

      const done = lessons.filter(l => l.completed);
      const tLM = done.reduce((s, l) => s + lm(l).m, 0);
      const mM = memories.filter(m => m.duration_minutes).reduce((s, m) => s + (m.duration_minutes || 0), 0);
      const dateGen = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      const childReport = childrenList.map(c => {
        const cl = done.filter(l => l.child_id === c.id);
        const cm = cl.reduce((s, l) => s + lm(l).m, 0);
        const cd = new Set(cl.map(l => ld(l)).filter(Boolean)).size;
        const sa: Record<string, { n: number; m: number; e: boolean }> = {};
        for (const l of cl) { const nm = l.subjects?.name || "General"; if (!sa[nm]) sa[nm] = { n: 0, m: 0, e: false }; sa[nm].n++; const r = lm(l); sa[nm].m += r.m; if (r.e) sa[nm].e = true; }
        return {
          name: c.name, totalHours: fmt(cm), totalLessons: cl.length, schoolDays: cd,
          subjects: Object.entries(sa).map(([n, d]) => ({ name: n, count: d.n, hours: fmt(d.m), estimated: d.e })).sort((a, b) => b.count - a.count),
          books: memories.filter(m => m.type === "book" && m.child_id === c.id).map(m => m.title || "Untitled"),
          fieldTrips: memories.filter(m => ["field_trip","project","activity"].includes(m.type) && m.child_id === c.id).map(m => ({ title: m.title || "Untitled", duration: m.duration_minutes })),
          wins: memories.filter(m => ["win","quote"].includes(m.type) && m.child_id === c.id).map(m => m.title || "Untitled"),
          badges: badges.filter(b => b.payload?.child_id === c.id).map(b => b.payload?.badge_name || "Badge"),
        };
      });

      const logMap: Record<string, { subject: string; description: string; minutes: number; type: string; estimated: boolean }[]> = {};
      for (const l of done) { const d = ld(l); if (!d) continue; if (!logMap[d]) logMap[d] = []; const r = lm(l); logMap[d].push({ subject: l.subjects?.name || "General", description: l.title || "Lesson", minutes: r.m, type: "Lesson", estimated: r.e }); }
      for (const m of memories) { if (!m.duration_minutes || !["field_trip","project","activity","win"].includes(m.type)) continue; if (!logMap[m.date]) logMap[m.date] = []; logMap[m.date].push({ subject: m.type === "win" ? "Win" : "Field Trip", description: m.title || "Activity", minutes: m.duration_minutes, type: "Activity", estimated: false }); }

      const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
      generateProgressReport(doc, {
        familyName: schoolName, schoolYear, dateGenerated: dateGen, showWatermark,
        summary: { totalHours: fmt(tLM + mM), schoolDays: new Set(done.map(l => ld(l)).filter(Boolean)).size, lessons: done.length, books: memories.filter(m => m.type === "book").length, trips: memories.filter(m => ["field_trip","project","activity"].includes(m.type)).length, memories: memories.length },
        children: childReport,
        dailyLog: Object.entries(logMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => ({ dateLabel: new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), entries })),
      });
      doc.save(`${(schoolName || "family-academy").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-progress-report.pdf`);
    } catch (e) { console.error(e); alert("Download failed. Please try again."); }
    finally { setDownloading(false); }
  }

  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#f0ede8] flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#2d2926]">📊 Progress Report</h3>
          <p className="text-[11px] text-[#b5aca4] mt-0.5">Full-year record with lessons, hours, books, activities, and daily log for state compliance</p>
        </div>
        <button onClick={handleDownload} disabled={downloading || childrenList.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0">
          <Download size={12} /> {downloading ? "Generating\u2026" : "Download Report"}
        </button>
      </div>
      <div className="px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="text-sm text-[#7a6f65]">
          <span className="font-semibold text-[#2d2926]">{childrenList.length}</span>{" "}
          {childrenList.length === 1 ? "student" : "students"} | {schoolYear}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none ml-auto">
          <input type="checkbox" checked={showWatermark} onChange={e => setShowWatermark(e.target.checked)} className="w-4 h-4 rounded accent-[#5c7f63]" />
          <span className="text-xs text-[#7a6f65]">Include &ldquo;Made with Rooted&rdquo; watermark</span>
        </label>
      </div>
      {childrenList.length === 0 && (
        <p className="px-5 pb-4 text-sm text-[#b5aca4] italic">Add children in Settings to generate a report card.</p>
      )}
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
  award, style, onDownload, downloading,
}: {
  award: EarnedAward;
  style: StyleId;
  onDownload: () => void;
  downloading: boolean;
}) {
  const meta = AWARD_META[award.award_type as keyof typeof AWARD_META];
  if (!meta) return null;
  const isNew = !award.downloaded_at;
  const childName = award.certificate_data?.childName;

  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-4 flex items-start gap-3 hover:shadow-sm transition-shadow">
      <span className="text-2xl shrink-0">{meta.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-[#2d2926] truncate">{meta.label}</p>
          {isNew && (
            <span className="text-[9px] font-bold text-white bg-[#5c7f63] px-1.5 py-0.5 rounded-full shrink-0">New!</span>
          )}
        </div>
        <p className="text-[11px] text-[#b5aca4] mt-0.5">
          {meta.isEducator ? "For you" : childName || ""}
        </p>
      </div>
      <button onClick={onDownload} disabled={downloading}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5c7f63] hover:text-[#3d5c42] disabled:opacity-50 shrink-0 mt-0.5">
        {downloading ? (
          <span className="inline-block w-3 h-3 border-2 border-[#5c7f63] border-t-transparent rounded-full animate-spin" />
        ) : (
          <Download size={12} />
        )}
        {downloading ? "Generating\u2026" : "Download"}
      </button>
    </div>
  );
}

// ─── Locked award card ───────────────────────────────────────────────────────

function LockedAwardCard({ awardType }: { awardType: string }) {
  const meta = AWARD_META[awardType as keyof typeof AWARD_META];
  if (!meta) return null;
  return (
    <div className="bg-[#f5f3ef] border border-[#e8e2d9] rounded-xl p-4 flex items-start gap-3 opacity-60">
      <span className="text-2xl shrink-0 grayscale">🔒</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#7a6f65] truncate">{meta.label}</p>
        <p className="text-[11px] text-[#b5aca4] mt-0.5">{meta.unlockHint}</p>
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
  const [reportWatermark, setReportWatermark] = useState(true);

  // Award states
  const [earnedAwards, setEarnedAwards] = useState<EarnedAward[]>([]);
  const [downloadingAward, setDownloadingAward] = useState<string | null>(null);
  const [showLocked, setShowLocked] = useState(false);

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

  useEffect(() => { document.title = "Printables — Rooted"; }, []);

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

      // Load earned awards
      const { data: awards } = await supabase
        .from("earned_awards").select("*").eq("user_id", uid).order("earned_at", { ascending: false });
      setEarnedAwards((awards || []) as EarnedAward[]);

      // Check for new awards
      try {
        const { checkAndGrantAwards } = await import("@/lib/award-unlocks");
        const allDates = new Set<string>();
        for (const l of (completedLessons || []) as { date?: string }[]) { if (l.date) allDates.add(l.date); }

        const { data: memoriesData } = await supabase
          .from("memories").select("id, type, child_id, title, date").eq("user_id", uid);

        const appData: AppData = {
          children: kidsArr.map(k => ({ id: k.id, name: k.name })),
          completedLessons: (completedLessons || []) as { child_id: string; date: string; scheduled_date?: string }[],
          memories: (memoriesData || []) as { id: string; type: string; child_id: string | null; title: string | null; date: string }[],
          totalSchoolDays: allDates.size,
          profile: { display_name: fName, created_at: session.user.created_at },
          academyName: fName ? `${fName} Academy` : "Family Academy",
        };

        const newAwards = await checkAndGrantAwards(uid, appData);
        if (newAwards.length > 0) {
          const { data: refreshed } = await supabase
            .from("earned_awards").select("*").eq("user_id", uid).order("earned_at", { ascending: false });
          setEarnedAwards((refreshed || []) as EarnedAward[]);
        }
      } catch (e) { console.error("[Awards check]", e); }
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

  async function handleAwardDownload(award: EarnedAward) {
    setDownloadingAward(award.id);
    try {
      await downloadCertificate(award.award_type, activeStyle, award.certificate_data || {});
      await supabase.from("earned_awards").update({ downloaded_at: new Date().toISOString() }).eq("id", award.id);
      setEarnedAwards(prev => prev.map(a => a.id === award.id ? { ...a, downloaded_at: new Date().toISOString() } : a));
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

  // Split awards
  const childAwards = earnedAwards.filter(a => {
    const meta = AWARD_META[a.award_type as keyof typeof AWARD_META];
    return meta && !meta.isEducator;
  });
  const educatorAwards = earnedAwards.filter(a => {
    const meta = AWARD_META[a.award_type as keyof typeof AWARD_META];
    return meta && meta.isEducator;
  });

  // Locked awards
  const allAwardTypes = Object.keys(AWARD_META).filter(t => t !== "custom");
  const earnedTypes = new Set(earnedAwards.map(a => `${a.award_type}-${a.child_id || "null"}`));
  const lockedTypes = allAwardTypes.filter(t => {
    const meta = AWARD_META[t as keyof typeof AWARD_META];
    if (!meta) return false;
    if (meta.isEducator) return !earnedAwards.some(a => a.award_type === t);
    return !earnedAwards.some(a => a.award_type === t);
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-[#2d2926]">🖨️ Printables</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          No Canva needed. Your certificates and ID cards — made beautiful automatically.
        </p>
      </div>

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
              <p className={`text-xs font-bold leading-tight ${activeStyle === s.id ? "text-[#3d5c42]" : "text-[#2d2926]"}`}>
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
      {childAwards.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-[#2d2926] mb-0.5">🎓 Your Certificates</h2>
          <p className="text-xs text-[#b5aca4] mb-4">These were earned. Download and print any time.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {childAwards.map(a => (
              <AwardCard key={a.id} award={a} style={activeStyle}
                onDownload={() => handleAwardDownload(a)}
                downloading={downloadingAward === a.id} />
            ))}
          </div>
        </section>
      )}

      {/* ── For the Educator ──────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">💛 For the Educator</h2>
        <p className="text-xs text-[#b5aca4] mb-4">You&apos;re doing the hardest part.</p>
        {educatorAwards.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {educatorAwards.map(a => (
              <AwardCard key={a.id} award={a} style={activeStyle}
                onDownload={() => handleAwardDownload(a)}
                downloading={downloadingAward === a.id} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#b5aca4] italic">Keep going — your first certificates will appear here soon.</p>
        )}
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
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
                <Download size={12} /> {downloadingAward === "manual-grad" ? "Generating\u2026" : "Download Certificate"}
              </button>
            </div>
            {/* Subject */}
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-3">
              <p className="text-sm font-bold text-[#2d2926]">📚 Subject Completion</p>
              <ChildSelect childrenList={children} value={subjectChild} onChange={(id) => setSubjectChild(id)} />
              <FieldInput label="Subject Name" value={subjectName} onChange={setSubjectName} placeholder="e.g. Math, Reading" />
              <button onClick={handleManualSubject} disabled={downloadingAward === "manual-subject" || !subjectName.trim()}
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
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
            className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors">
            <Download size={12} /> {customDownloading ? "Generating\u2026" : "Download Certificate"}
          </button>
        </div>
      </section>

      {/* ── Coming Up (locked) ─────────────────────────────────────── */}
      {lockedTypes.length > 0 && (
        <section>
          <button onClick={() => setShowLocked(!showLocked)}
            className="flex items-center gap-2 text-base font-bold text-[#2d2926] mb-2 hover:text-[#5c7f63] transition-colors">
            🔒 Coming Up
            {showLocked ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showLocked && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {lockedTypes.map(t => <LockedAwardCard key={t} awardType={t} />)}
            </div>
          )}
        </section>
      )}

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

      {/* ── Progress Report ──────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">📊 Progress Report</h2>
        <p className="text-xs text-[#b5aca4] mb-4">Download a full record of lessons, hours, and progress.</p>
        <AnnualReportCard childrenList={children} schoolName={schoolName}
          schoolYear={currentYearRange()} showWatermark={reportWatermark} setShowWatermark={setReportWatermark} />
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
  );
}
