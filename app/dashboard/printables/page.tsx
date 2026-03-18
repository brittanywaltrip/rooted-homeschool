"use client";

import { useState, useEffect, useCallback } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";

// ─── Types ─────────────────────────────────────────────────────────────────

type StyleId = 1 | 2 | 3;

interface CardFields {
  schoolName: string;
  name: string;
  title: string;
  schoolYear: string;
  state: string;
  showWatermark: boolean;
}

interface Child {
  id: string;
  name: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function currentYearRange(): string {
  const y = new Date().getFullYear();
  return `${y}–${y + 1}`;
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

// ─── Style selector data ─────────────────────────────────────────────────────

const STYLES: { id: StyleId; name: string; desc: string }[] = [
  { id: 1, name: "Classic Elegant",   desc: "Serif · Gold accents"     },
  { id: 2, name: "Modern Clean",      desc: "Bold sans-serif · Minimal" },
  { id: 3, name: "Botanical Natural", desc: "Warm cream · 🌿 logo"     },
];

// ─── Card preview (live React component, pixel-scaled) ────────────────────

// Base dimensions: 252 × 144 px  (= 3.5" × 2" @ 72 dpi)
const BW = 252;
const BH = 144;

function CardPreview({ style, fields, scale = 1 }: { style: StyleId; fields: CardFields; scale?: number }) {
  const W = Math.round(BW * scale);
  const H = Math.round(BH * scale);
  const s = (n: number) => Math.round(n * scale);

  const base: React.CSSProperties = {
    width: W, height: H, boxSizing: "border-box", overflow: "hidden", flexShrink: 0,
  };

  if (style === 1) {
    return (
      <div style={{
        ...base,
        backgroundColor: "#fffef8",
        border: `${s(2)}px solid #2d5a3d`,
        position: "relative",
        fontFamily: "Georgia, 'Times New Roman', serif",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: s(14),
      }}>
        {/* Gold inner border */}
        <div style={{ position: "absolute", inset: s(5), border: `${s(1)}px solid #c4922a`, pointerEvents: "none" }} />
        {/* Corner flourishes */}
        {([
          { top: s(3), left: s(3),  borderTop: `${s(1.5)}px solid #c4922a`, borderLeft:  `${s(1.5)}px solid #c4922a` },
          { top: s(3), right: s(3), borderTop: `${s(1.5)}px solid #c4922a`, borderRight: `${s(1.5)}px solid #c4922a` },
          { bottom: s(3), left: s(3),  borderBottom: `${s(1.5)}px solid #c4922a`, borderLeft:  `${s(1.5)}px solid #c4922a` },
          { bottom: s(3), right: s(3), borderBottom: `${s(1.5)}px solid #c4922a`, borderRight: `${s(1.5)}px solid #c4922a` },
        ] as React.CSSProperties[]).map((corner, i) => (
          <div key={i} style={{ position: "absolute", width: s(10), height: s(10), ...corner }} />
        ))}
        <div style={{ textAlign: "center", zIndex: 1, lineHeight: 1.4 }}>
          <p style={{ fontSize: s(7.5), color: "#c4922a", letterSpacing: s(0.8), textTransform: "uppercase", margin: `0 0 ${s(3)}px` }}>
            {fields.schoolName || "Family Academy"}
          </p>
          <p style={{ fontSize: s(12), fontWeight: "bold", color: "#2d2926", margin: `0 0 ${s(1)}px` }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7.5), color: "#7a6f65", fontStyle: "italic", margin: `0 0 ${s(5)}px` }}>
            {fields.title}
          </p>
          <div style={{ width: s(44), height: 1, backgroundColor: "#c4922a", margin: `0 auto ${s(5)}px` }} />
          <p style={{ fontSize: s(7), color: "#7a6f65", margin: 0 }}>
            {[fields.state, fields.schoolYear].filter(Boolean).join(" · ")}
          </p>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5.5), color: "#c4bfb8", margin: `${s(4)}px 0 0` }}>Made with Rooted</p>
          )}
        </div>
      </div>
    );
  }

  if (style === 2) {
    return (
      <div style={{
        ...base,
        backgroundColor: "#ffffff",
        border: `${s(1)}px solid #e8e2d9`,
        display: "flex",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        <div style={{ width: s(18), backgroundColor: "#2d5a3d", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: s(10), transform: "rotate(-90deg)", display: "block", lineHeight: 1 }}>🌿</span>
        </div>
        <div style={{ flex: 1, padding: `${s(12)}px ${s(14)}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ fontSize: s(6.5), color: "#5c7f63", fontWeight: 800, textTransform: "uppercase", letterSpacing: s(0.8), margin: `0 0 ${s(2)}px` }}>
            {fields.schoolName || "Family Academy"}
          </p>
          <p style={{ fontSize: s(13), fontWeight: 900, color: "#2d2926", lineHeight: 1.1, margin: `0 0 ${s(2)}px` }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7.5), color: "#7a6f65", margin: `0 0 ${s(8)}px` }}>
            {fields.title}
          </p>
          <div style={{ display: "flex", gap: s(10) }}>
            {fields.state    && <p style={{ fontSize: s(7), color: "#b5aca4", margin: 0 }}>{fields.state}</p>}
            {fields.schoolYear && <p style={{ fontSize: s(7), color: "#b5aca4", margin: 0 }}>{fields.schoolYear}</p>}
          </div>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5.5), color: "#d4cfc9", margin: `${s(5)}px 0 0` }}>Made with Rooted</p>
          )}
        </div>
      </div>
    );
  }

  // Style 3 — Botanical Natural
  return (
    <div style={{
      ...base,
      backgroundColor: "#fdfcf8",
      border: `${s(1)}px solid #d4cfc9`,
      display: "flex", flexDirection: "column",
      fontFamily: "Georgia, 'Times New Roman', serif",
    }}>
      <div style={{ backgroundColor: "#5c7f63", padding: `${s(6)}px ${s(12)}px`, display: "flex", alignItems: "center", gap: s(5) }}>
        <span style={{ fontSize: s(10), lineHeight: 1 }}>🌿</span>
        <p style={{ fontSize: s(7.5), fontWeight: "bold", color: "white", letterSpacing: s(0.3), margin: 0 }}>
          {fields.schoolName || "Family Academy"}
        </p>
      </div>
      <div style={{ flex: 1, padding: `${s(8)}px ${s(12)}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <p style={{ fontSize: s(14), fontStyle: "italic", color: "#2d2926", margin: `0 0 ${s(2)}px`, lineHeight: 1.2 }}>
          {fields.name || "Your Name"}
        </p>
        <p style={{ fontSize: s(7.5), color: "#7a6f65", margin: `0 0 ${s(8)}px` }}>
          {fields.title}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: s(5) }}>
          <span style={{ fontSize: s(8) }}>🍃🍃🍃</span>
          <p style={{ fontSize: s(7), color: "#b5aca4", margin: 0 }}>
            {[fields.state, fields.schoolYear].filter(Boolean).join(" · ")}
          </p>
        </div>
        {fields.showWatermark && (
          <p style={{ fontSize: s(5.5), color: "#c4bfb8", margin: `${s(5)}px 0 0` }}>Made with Rooted</p>
        )}
      </div>
    </div>
  );
}

// ─── PDF download via jsPDF ──────────────────────────────────────────────────

// Renders a card as HTML string at 336×192 px (3.5"×2" @ 96dpi)
function cardBodyHtml(style: StyleId, f: CardFields): string {
  const school = f.schoolName || "Family Academy";
  const name   = f.name || "Name";
  const wm     = f.showWatermark ? `<p style="font-size:7px;color:#c4bfb8;margin:6px 0 0;">Made with Rooted</p>` : "";
  const loc    = [f.state, f.schoolYear].filter(Boolean).join(" · ");

  if (style === 1) return `
<div style="width:336px;height:192px;background:#fffef8;border:2.5px solid #2d5a3d;box-sizing:border-box;
  position:relative;font-family:Georgia,serif;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:16px;">
  <div style="position:absolute;inset:6px;border:1px solid #c4922a;"></div>
  <div style="position:absolute;top:3px;left:3px;width:13px;height:13px;border-top:1.5px solid #c4922a;border-left:1.5px solid #c4922a;"></div>
  <div style="position:absolute;top:3px;right:3px;width:13px;height:13px;border-top:1.5px solid #c4922a;border-right:1.5px solid #c4922a;"></div>
  <div style="position:absolute;bottom:3px;left:3px;width:13px;height:13px;border-bottom:1.5px solid #c4922a;border-left:1.5px solid #c4922a;"></div>
  <div style="position:absolute;bottom:3px;right:3px;width:13px;height:13px;border-bottom:1.5px solid #c4922a;border-right:1.5px solid #c4922a;"></div>
  <div style="text-align:center;z-index:1;line-height:1.4;">
    <p style="font-size:10px;color:#c4922a;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px;">${school}</p>
    <p style="font-size:16px;font-weight:bold;color:#2d2926;margin:0 0 2px;">${name}</p>
    <p style="font-size:10px;color:#7a6f65;font-style:italic;margin:0 0 7px;">${f.title}</p>
    <div style="width:48px;height:1px;background:#c4922a;margin:0 auto 7px;"></div>
    <p style="font-size:9px;color:#7a6f65;margin:0;">${loc}</p>
    ${wm}
  </div>
</div>`;

  if (style === 2) return `
<div style="width:336px;height:192px;background:#fff;border:1px solid #e8e2d9;box-sizing:border-box;
  display:flex;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden;">
  <div style="width:24px;background:#2d5a3d;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
    <span style="font-size:13px;transform:rotate(-90deg);display:block;line-height:1;">🌿</span>
  </div>
  <div style="flex:1;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;">
    <p style="font-size:8.5px;color:#5c7f63;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 3px;">${school}</p>
    <p style="font-size:17px;font-weight:900;color:#2d2926;line-height:1.1;margin:0 0 3px;">${name}</p>
    <p style="font-size:10px;color:#7a6f65;margin:0 0 10px;">${f.title}</p>
    <div style="display:flex;gap:14px;">
      ${f.state      ? `<p style="font-size:9px;color:#b5aca4;margin:0;">${f.state}</p>` : ""}
      ${f.schoolYear ? `<p style="font-size:9px;color:#b5aca4;margin:0;">${f.schoolYear}</p>` : ""}
    </div>
    ${wm}
  </div>
</div>`;

  return `
<div style="width:336px;height:192px;background:#fdfcf8;border:1px solid #d4cfc9;box-sizing:border-box;
  display:flex;flex-direction:column;font-family:Georgia,serif;overflow:hidden;">
  <div style="background:#5c7f63;padding:8px 16px;display:flex;align-items:center;gap:7px;">
    <span style="font-size:13px;line-height:1;">🌿</span>
    <p style="font-size:10px;font-weight:bold;color:white;margin:0;">${school}</p>
  </div>
  <div style="flex:1;padding:10px 16px;display:flex;flex-direction:column;justify-content:center;">
    <p style="font-size:18px;font-style:italic;color:#2d2926;margin:0 0 3px;line-height:1.2;">${name}</p>
    <p style="font-size:10px;color:#7a6f65;margin:0 0 10px;">${f.title}</p>
    <div style="display:flex;align-items:center;gap:7px;">
      <span style="font-size:10px;">🍃🍃🍃</span>
      <p style="font-size:9px;color:#b5aca4;margin:0;">${loc}</p>
    </div>
    ${wm}
  </div>
</div>`;
}

async function downloadCard(style: StyleId, fields: CardFields, label: string) {
  const { jsPDF } = await import("jspdf");
  // Business card: 3.5" × 2"
  const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [3.5, 2] });

  // Render card HTML in a hidden iframe, then use html() method
  const body = cardBodyHtml(style, fields);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:336px;height:192px;overflow:hidden;}</style>
</head><body>${body}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:336px;height:192px;border:none;";
  document.body.appendChild(iframe);
  iframe.contentDocument!.open();
  iframe.contentDocument!.write(html);
  iframe.contentDocument!.close();

  await new Promise(r => setTimeout(r, 300));

  await doc.html(iframe.contentDocument!.body, {
    x: 0, y: 0,
    width: 3.5,
    windowWidth: 336,
    html2canvas: { scale: 2, useCORS: true },
  });

  document.body.removeChild(iframe);
  doc.save(`${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`);
}

// ─── Shared field input ──────────────────────────────────────────────────────

function FieldInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]"
      />
    </div>
  );
}

// ─── ID card editor ──────────────────────────────────────────────────────────

function IDCardEditor({
  style, fields, onChange, cardLabel,
}: {
  style: StyleId;
  fields: CardFields;
  onChange: (f: CardFields) => void;
  cardLabel: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const set = (key: keyof CardFields, val: string | boolean) => onChange({ ...fields, [key]: val });

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadCard(style, fields, cardLabel);
    } catch (e) {
      console.error(e);
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#f0ede8] flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-[#2d2926]">{cardLabel}</h3>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
        >
          <Download size={12} />
          {downloading ? "Generating…" : "Download ID Card"}
        </button>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fields */}
        <div className="space-y-3">
          <FieldInput label="School Name" value={fields.schoolName} onChange={v => set("schoolName", v)} />
          <FieldInput
            label={cardLabel.toLowerCase().includes("student") ? "Student Name" : "Parent Name"}
            value={fields.name}
            onChange={v => set("name", v)}
          />
          <FieldInput label="Title" value={fields.title} onChange={v => set("title", v)} />
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="School Year" value={fields.schoolYear} onChange={v => set("schoolYear", v)} />
            <FieldInput label="State" value={fields.state} onChange={v => set("state", v)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fields.showWatermark}
              onChange={e => set("showWatermark", e.target.checked)}
              className="w-4 h-4 rounded accent-[#5c7f63]"
            />
            <span className="text-xs text-[#7a6f65]">Include "Made with Rooted" on card</span>
          </label>
        </div>

        {/* Live preview */}
        <div className="flex flex-col items-center justify-center gap-3">
          <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-wide">Live Preview</p>
          <div className="shadow-lg rounded overflow-hidden">
            <CardPreview style={style} fields={fields} scale={1.55} />
          </div>
          <p className="text-[10px] text-[#b5aca4]">3.5″ × 2″ — standard business card size</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PrintablesPage() {
  const partnerCtx = usePartner();
  const [activeStyle, setActiveStyle] = useState<StyleId>(1);
  const [familyName,  setFamilyName]  = useState("");
  const [stateCode,   setStateCode]   = useState("");
  const [children,    setChildren]    = useState<Child[]>([]);
  const [parentFields, setParentFields] = useState<CardFields | null>(null);
  const [childFields,  setChildFields]  = useState<Record<string, CardFields>>({});

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const uid = partnerCtx.effectiveUserId || session.user.id;

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, state")
        .eq("id", uid)
        .maybeSingle();

      const fName = (profile as { display_name?: string } | null)?.display_name || "";
      const st    = (profile as { state?: string }         | null)?.state        || "";
      setFamilyName(fName);
      setStateCode(st);
      setParentFields(makeParentDefaults(fName, st));

      const { data: kids } = await supabase
        .from("children")
        .select("id, name")
        .eq("user_id", uid)
        .order("created_at");

      const kidsArr: Child[] = (kids || []).map((k: { id: string; name: string }) => ({ id: k.id, name: k.name }));
      setChildren(kidsArr);

      const map: Record<string, CardFields> = {};
      for (const kid of kidsArr) {
        map[kid.id] = makeChildDefaults(kid.name, fName, st);
      }
      setChildFields(map);
    }
    load();
  }, [partnerCtx.effectiveUserId]);

  const updateChildField = useCallback((id: string, f: CardFields) => {
    setChildFields(prev => ({ ...prev, [id]: f }));
  }, []);

  // Sample fields for style selector thumbnails
  const sampleFields: CardFields = {
    schoolName: familyName ? `${familyName} Academy` : "Family Academy",
    name: "Sample Name",
    title: "Student",
    schoolYear: currentYearRange(),
    state: stateCode || "NV",
    showWatermark: false,
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-10">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-[#2d2926]">🖨️ Printables</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          ID cards, certificates, and printable tools for your homeschool.
        </p>
      </div>

      {/* ── Style selector ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">Card Style</h2>
        <p className="text-xs text-[#b5aca4] mb-4">
          Choose a style — applies to all cards and certificates on this page.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveStyle(s.id)}
              className={`text-left rounded-xl border-2 p-3 transition-all ${
                activeStyle === s.id
                  ? "border-[#5c7f63] shadow-md shadow-[#5c7f63]/10 bg-[#fefcf9]"
                  : "border-[#e8e2d9] bg-white hover:border-[#c4bfb8]"
              }`}
            >
              <div className="mb-2.5 rounded overflow-hidden shadow-sm w-fit">
                <CardPreview style={s.id} fields={sampleFields} scale={0.6} />
              </div>
              <p className={`text-xs font-bold leading-tight ${activeStyle === s.id ? "text-[#3d5c42]" : "text-[#2d2926]"}`}>
                {s.name}
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

      {/* ── ID Cards ─────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-[#2d2926]">🪪 Homeschool ID Cards</h2>
          <p className="text-xs text-[#b5aca4] mt-1 max-w-2xl leading-relaxed">
            Homeschool ID cards are provided as a convenience tool. Rooted Homeschool does not guarantee
            acceptance at any discount program, retailer, or institution. Always verify a program&apos;s
            homeschool verification requirements before applying.
          </p>
        </div>

        {/* Parent ID */}
        {parentFields ? (
          <IDCardEditor
            style={activeStyle}
            fields={parentFields}
            onChange={setParentFields}
            cardLabel="Parent Homeschool Administrator ID"
          />
        ) : (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-6 py-8 flex items-center justify-center">
            <span className="text-2xl animate-pulse">🌿</span>
          </div>
        )}

        {/* Student IDs */}
        {children.map((child) => {
          const fields = childFields[child.id];
          if (!fields) return null;
          return (
            <IDCardEditor
              key={child.id}
              style={activeStyle}
              fields={fields}
              onChange={(f) => updateChildField(child.id, f)}
              cardLabel={`${child.name}'s Student ID`}
            />
          );
        })}

        {parentFields && children.length === 0 && (
          <p className="text-sm text-[#b5aca4] italic px-1">
            Add children in Settings to generate their student ID cards.
          </p>
        )}
      </section>

      {/* ── Certificates — placeholder for Section 2 ─────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-4">🎓 Certificates</h2>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-6 py-10 text-center">
          <p className="text-3xl mb-2">🌿</p>
          <p className="text-sm font-medium text-[#7a6f65]">Certificates coming soon</p>
          <p className="text-xs text-[#b5aca4] mt-1">
            Completion, attendance, and achievement certificates — styled to match your chosen card style.
          </p>
        </div>
      </section>

    </div>
  );
}
