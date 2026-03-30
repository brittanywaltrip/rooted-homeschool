"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PaywallCard from "@/components/PaywallCard";

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

interface ChildData {
  id: string;
  name: string;
  leaves: number;
  streak: number;
}

interface CertDisplay {
  schoolName: string;
  childName: string;
  certTitle: string;
  accomplishment: string;
  schoolYear: string;
  showWatermark: boolean;
}

interface GradCert {
  childId: string; childName: string;
  schoolName: string; schoolYear: string;
  gradeLevel: string; certText: string; showWatermark: boolean;
}
interface SubjectCert {
  childId: string; childName: string;
  schoolName: string; schoolYear: string;
  subjectName: string; certText: string; showWatermark: boolean;
}
interface StreakCert {
  childId: string; childName: string;
  schoolName: string; schoolYear: string;
  streakCount: string; certText: string; showWatermark: boolean;
}
interface GardenCert {
  childId: string; childName: string;
  schoolName: string; schoolYear: string;
  leafCount: string; stageName: string; certText: string; showWatermark: boolean;
}
interface BookCert {
  childId: string; childName: string;
  schoolName: string; schoolYear: string;
  bookTitle: string; certText: string; showWatermark: boolean;
}
interface PerfWeekCert {
  childId: string; childName: string;
  schoolName: string; schoolYear: string;
  dateRange: string; certText: string; showWatermark: boolean;
}

interface BackFields {
  include: boolean;
  address: string;
  websiteOrEmail: string;
  note: string;
  includeQR: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function currentYearRange(): string {
  const now = new Date();
  const y = now.getFullYear();
  // Academic year: Aug–Jul. Before July → still the previous school year.
  return now.getMonth() < 7 ? `${y - 1}–${y}` : `${y}–${y + 1}`;
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const STAGE_THRESHOLDS = [
  { min: 0,   name: "Seedling"     },
  { min: 10,  name: "Sprout"       },
  { min: 25,  name: "Sapling"      },
  { min: 50,  name: "Young Tree"   },
  { min: 100, name: "Growing Tree" },
  { min: 200, name: "Tall Tree"    },
  { min: 350, name: "Ancient Tree" },
];

function stageNameFromLeaves(leaves: number): string {
  let stage = STAGE_THRESHOLDS[0].name;
  for (const t of STAGE_THRESHOLDS) {
    if (leaves >= t.min) stage = t.name;
  }
  return stage;
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

const STYLES: { id: StyleId; name: string; desc: string }[] = [
  { id: 1, name: "Classic Elegant",   desc: "Serif · Gold accents"     },
  { id: 2, name: "Modern Clean",      desc: "Bold sans-serif · Minimal" },
  { id: 3, name: "Botanical Natural", desc: "Warm cream · 🌿 logo"     },
];

// ─── Card preview (live React component, pixel-scaled) ────────────────────

const BW = 252;
const BH = 144;
const CW = 816;
const CH = 1056;

// Photo slot dimensions in base (252×144) units.
// On the HTML card (336×192 @ 96dpi): 96px wide × 120px tall, 10px left inset, centred vertically.
// Scales cleanly to PDF (1.0" × 1.25").
const PHOTO_BASE_W = 72;   // 96 * (252/336)
const PHOTO_BASE_H = 90;   // 120 * (252/336)
const PHOTO_BASE_L = 8;    // left inset in base units
const PHOTO_BASE_T = Math.round((BH - PHOTO_BASE_H) / 2); // ~27

// jsPDF coordinates (unit = "in", landscape 3.5"×2")
const PHOTO_PDF_X = 0.104; // 10px / 96dpi
const PHOTO_PDF_Y = 0.375; // 36px / 96dpi
const PHOTO_PDF_W = 1.0;
const PHOTO_PDF_H = 1.25;

function CardPreview({
  style, fields, photoUrl, scale = 1,
}: {
  style: StyleId; fields: CardFields; photoUrl?: string | null; scale?: number;
}) {
  const W = Math.round(BW * scale);
  const H = Math.round(BH * scale);
  const s = (n: number) => Math.round(n * scale);

  // When photoUrl is undefined the style-selector thumbails render without a photo slot.
  const showSlot = photoUrl !== undefined;

  const photoSlot = showSlot ? (
    <div style={{
      flexShrink: 0,
      width: s(PHOTO_BASE_W), height: s(PHOTO_BASE_H),
      marginTop: s(PHOTO_BASE_T),
      marginBottom: s(PHOTO_BASE_T),
      marginLeft: s(PHOTO_BASE_L),
      marginRight: s(6),
      border: photoUrl ? "none" : `${s(1)}px dashed #c4bfb8`,
      borderRadius: s(2),
      overflow: "hidden",
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

  if (style === 1) {
    return (
      <div style={{
        ...base,
        backgroundColor: "#fffef8",
        border: `${s(2)}px solid #2d5a3d`,
        position: "relative",
        fontFamily: "Georgia, 'Times New Roman', serif",
        display: "flex", flexDirection: "row", alignItems: "center",
      }}>
        <div style={{ position: "absolute", inset: s(5), border: `${s(1)}px solid #c4922a`, pointerEvents: "none" }} />
        {([
          { top: s(3), left: s(3),  borderTop: `${s(1.5)}px solid #c4922a`, borderLeft:  `${s(1.5)}px solid #c4922a` },
          { top: s(3), right: s(3), borderTop: `${s(1.5)}px solid #c4922a`, borderRight: `${s(1.5)}px solid #c4922a` },
          { bottom: s(3), left: s(3),  borderBottom: `${s(1.5)}px solid #c4922a`, borderLeft:  `${s(1.5)}px solid #c4922a` },
          { bottom: s(3), right: s(3), borderBottom: `${s(1.5)}px solid #c4922a`, borderRight: `${s(1.5)}px solid #c4922a` },
        ] as React.CSSProperties[]).map((corner, i) => (
          <div key={i} style={{ position: "absolute", width: s(10), height: s(10), ...corner }} />
        ))}
        {photoSlot}
        <div style={{ flex: 1, zIndex: 1, lineHeight: 1.4, paddingRight: s(showSlot ? 10 : 14), paddingLeft: showSlot ? 0 : s(14), textAlign: showSlot ? "left" : "center" }}>
          <p style={{ fontSize: s(7.5), color: "#c4922a", letterSpacing: s(0.8), textTransform: "uppercase", margin: `0 0 ${s(3)}px` }}>
            {fields.schoolName || "Family Academy"}
          </p>
          <p style={{ fontSize: s(11), fontWeight: "bold", color: "#2d2926", margin: `0 0 ${s(1)}px`, lineHeight: 1.2 }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7), color: "#7a6f65", fontStyle: "italic", margin: `0 0 ${s(4)}px` }}>
            {fields.title}
          </p>
          <div style={{ width: s(showSlot ? 36 : 44), height: 1, backgroundColor: "#c4922a", margin: `0 ${showSlot ? "0" : "auto"} ${s(4)}px` }} />
          <p style={{ fontSize: s(6.5), color: "#7a6f65", margin: 0 }}>
            {[fields.state, fields.schoolYear].filter(Boolean).join(" · ")}
          </p>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5), color: "#c4bfb8", margin: `${s(3)}px 0 0` }}>Made with Rooted</p>
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
        {photoSlot}
        <div style={{ flex: 1, padding: `${s(10)}px ${s(10)}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ fontSize: s(6), color: "#5c7f63", fontWeight: 800, textTransform: "uppercase", letterSpacing: s(0.6), margin: `0 0 ${s(2)}px` }}>
            {fields.schoolName || "Family Academy"}
          </p>
          <p style={{ fontSize: s(showSlot ? 11 : 13), fontWeight: 900, color: "#2d2926", lineHeight: 1.1, margin: `0 0 ${s(2)}px` }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7), color: "#7a6f65", margin: `0 0 ${s(6)}px` }}>
            {fields.title}
          </p>
          <div style={{ display: "flex", gap: s(8) }}>
            {fields.state    && <p style={{ fontSize: s(6.5), color: "#b5aca4", margin: 0 }}>{fields.state}</p>}
            {fields.schoolYear && <p style={{ fontSize: s(6.5), color: "#b5aca4", margin: 0 }}>{fields.schoolYear}</p>}
          </div>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5), color: "#d4cfc9", margin: `${s(4)}px 0 0` }}>Made with Rooted</p>
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
      <div style={{ backgroundColor: "#5c7f63", padding: `${s(5)}px ${s(10)}px`, display: "flex", alignItems: "center", gap: s(5) }}>
        <span style={{ fontSize: s(9), lineHeight: 1 }}>🌿</span>
        <p style={{ fontSize: s(7), fontWeight: "bold", color: "white", letterSpacing: s(0.3), margin: 0 }}>
          {fields.schoolName || "Family Academy"}
        </p>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
        {photoSlot}
        <div style={{ flex: 1, padding: `${s(6)}px ${s(8)}px ${s(6)}px ${showSlot ? 0 : s(10)}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ fontSize: s(showSlot ? 11 : 14), fontStyle: "italic", color: "#2d2926", margin: `0 0 ${s(2)}px`, lineHeight: 1.2 }}>
            {fields.name || "Your Name"}
          </p>
          <p style={{ fontSize: s(7), color: "#7a6f65", margin: `0 0 ${s(5)}px` }}>
            {fields.title}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: s(4) }}>
            <span style={{ fontSize: s(7) }}>🍃🍃🍃</span>
            <p style={{ fontSize: s(6.5), color: "#b5aca4", margin: 0 }}>
              {[fields.state, fields.schoolYear].filter(Boolean).join(" · ")}
            </p>
          </div>
          {fields.showWatermark && (
            <p style={{ fontSize: s(5), color: "#c4bfb8", margin: `${s(4)}px 0 0` }}>Made with Rooted</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card PDF (business card 3.5"×2") ────────────────────────────────────────

// Photo placeholder rendered in HTML for layout purposes; actual photo overlaid
// afterwards via doc.addImage() in downloadCard().
// HTML card is 336×192px. Photo slot: 96×120px, x=10, y=36.
const PHOTO_HTML_X = 10;
const PHOTO_HTML_Y = 36;
const PHOTO_HTML_W = 96;
const PHOTO_HTML_H = 120;

const photoPlaceholderHtml = `<div style="width:${PHOTO_HTML_W}px;height:${PHOTO_HTML_H}px;flex-shrink:0;border:1px dashed #c4bfb8;box-sizing:border-box;align-self:center;margin-left:${PHOTO_HTML_X}px;margin-right:8px;"></div>`;

function cardBodyHtml(style: StyleId, f: CardFields): string {
  const school = f.schoolName || "Family Academy";
  const name   = f.name || "Name";
  const wm     = f.showWatermark ? `<p style="font-size:7px;color:#c4bfb8;margin:5px 0 0;">Made with Rooted</p>` : "";
  const loc    = [f.state, f.schoolYear].filter(Boolean).join(" · ");

  if (style === 1) return `
<div style="width:336px;height:192px;background:#fffef8;border:4px solid #2d5a3d;box-sizing:border-box;
  position:relative;font-family:Georgia,serif;display:flex;flex-direction:row;align-items:center;">
  <div style="position:absolute;inset:6px;border:3px solid #c4922a;pointer-events:none;"></div>
  <div style="position:absolute;top:3px;left:3px;width:13px;height:13px;border-top:3px solid #c4922a;border-left:3px solid #c4922a;"></div>
  <div style="position:absolute;top:3px;right:3px;width:13px;height:13px;border-top:3px solid #c4922a;border-right:3px solid #c4922a;"></div>
  <div style="position:absolute;bottom:3px;left:3px;width:13px;height:13px;border-bottom:3px solid #c4922a;border-left:3px solid #c4922a;"></div>
  <div style="position:absolute;bottom:3px;right:3px;width:13px;height:13px;border-bottom:3px solid #c4922a;border-right:3px solid #c4922a;"></div>
  ${photoPlaceholderHtml}
  <div style="flex:1;line-height:1.4;padding-right:12px;z-index:1;">
    <p style="font-size:9px;color:#c4922a;letter-spacing:1px;text-transform:uppercase;margin:0 0 3px;">${school}</p>
    <p style="font-size:14px;font-weight:bold;color:#2d2926;margin:0 0 2px;">${name}</p>
    <p style="font-size:9px;color:#7a6f65;font-style:italic;margin:0 0 6px;">${f.title}</p>
    <div style="width:44px;height:1px;background:#c4922a;margin:0 0 6px;"></div>
    <p style="font-size:8px;color:#7a6f65;margin:0;">${loc}</p>
    ${wm}
  </div>
</div>`;

  if (style === 2) return `
<div style="width:336px;height:192px;background:#fff;border:3px solid #e8e2d9;box-sizing:border-box;
  display:flex;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden;align-items:center;">
  <div style="width:24px;height:192px;background:#2d5a3d;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
    <span style="font-size:13px;transform:rotate(-90deg);display:block;line-height:1;">🌿</span>
  </div>
  ${photoPlaceholderHtml}
  <div style="flex:1;padding:12px 12px;display:flex;flex-direction:column;justify-content:center;">
    <p style="font-size:8px;color:#5c7f63;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 2px;">${school}</p>
    <p style="font-size:14px;font-weight:900;color:#2d2926;line-height:1.1;margin:0 0 2px;">${name}</p>
    <p style="font-size:9px;color:#7a6f65;margin:0 0 8px;">${f.title}</p>
    <div style="display:flex;gap:10px;">
      ${f.state      ? `<p style="font-size:8px;color:#b5aca4;margin:0;">${f.state}</p>` : ""}
      ${f.schoolYear ? `<p style="font-size:8px;color:#b5aca4;margin:0;">${f.schoolYear}</p>` : ""}
    </div>
    ${wm}
  </div>
</div>`;

  return `
<div style="width:336px;height:192px;background:#fdfcf8;border:3px solid #d4cfc9;box-sizing:border-box;
  display:flex;flex-direction:column;font-family:Georgia,serif;overflow:hidden;">
  <div style="background:#5c7f63;padding:7px 14px;display:flex;align-items:center;gap:6px;">
    <span style="font-size:11px;line-height:1;">🌿</span>
    <p style="font-size:9px;font-weight:bold;color:white;margin:0;">${school}</p>
  </div>
  <div style="flex:1;display:flex;flex-direction:row;align-items:center;overflow:hidden;">
    ${photoPlaceholderHtml}
    <div style="flex:1;padding:8px 10px 8px 0;display:flex;flex-direction:column;justify-content:center;">
      <p style="font-size:13px;font-style:italic;color:#2d2926;margin:0 0 2px;line-height:1.2;">${name}</p>
      <p style="font-size:9px;color:#7a6f65;margin:0 0 6px;">${f.title}</p>
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:9px;">🍃🍃🍃</span>
        <p style="font-size:8px;color:#b5aca4;margin:0;">${loc}</p>
      </div>
      ${wm}
    </div>
  </div>
</div>`;
}

// ─── Card back HTML ───────────────────────────────────────────────────────────

function cardBackBodyHtml(style: StyleId, f: CardFields, back: BackFields, qrDataUrl: string | null): string {
  const school = f.schoolName || "Family Academy";
  const addr   = back.address       ? `<p style="font-size:8px;color:#7a6f65;margin:0 0 2px;">${back.address}</p>` : "";
  const web    = back.websiteOrEmail ? `<p style="font-size:8px;color:#5c7f63;margin:0 0 2px;">${back.websiteOrEmail}</p>` : "";
  const note   = back.note          ? `<p style="font-size:7.5px;color:#7a6f65;font-style:italic;margin:0 0 2px;">${back.note}</p>` : "";
  const qr     = qrDataUrl          ? `<img src="${qrDataUrl}" style="width:44px;height:44px;display:block;margin:4px auto 0;" alt="QR" />` : "";

  if (style === 1) return `
<div style="width:336px;height:192px;background:#fffef8;border:4px solid #2d5a3d;box-sizing:border-box;
  position:relative;font-family:Georgia,serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;">
  <div style="position:absolute;inset:6px;border:3px solid #c4922a;"></div>
  <div style="position:absolute;top:3px;left:3px;width:13px;height:13px;border-top:3px solid #c4922a;border-left:3px solid #c4922a;"></div>
  <div style="position:absolute;top:3px;right:3px;width:13px;height:13px;border-top:3px solid #c4922a;border-right:3px solid #c4922a;"></div>
  <div style="position:absolute;bottom:3px;left:3px;width:13px;height:13px;border-bottom:3px solid #c4922a;border-left:3px solid #c4922a;"></div>
  <div style="position:absolute;bottom:3px;right:3px;width:13px;height:13px;border-bottom:3px solid #c4922a;border-right:3px solid #c4922a;"></div>
  <div style="text-align:center;z-index:1;line-height:1.5;">
    <p style="font-size:10px;color:#c4922a;letter-spacing:1px;text-transform:uppercase;margin:0 0 4px;">${school}</p>
    ${addr}${web}${note}${qr}
  </div>
</div>`;

  if (style === 2) return `
<div style="width:336px;height:192px;background:#fff;border:3px solid #e8e2d9;box-sizing:border-box;
  display:flex;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden;align-items:stretch;">
  <div style="width:24px;background:#2d5a3d;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
    <span style="font-size:13px;transform:rotate(-90deg);display:block;line-height:1;">🌿</span>
  </div>
  <div style="flex:1;padding:14px 16px;display:flex;flex-direction:column;justify-content:center;">
    <p style="font-size:8px;color:#5c7f63;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 4px;">${school}</p>
    ${addr}${web}${note}
  </div>
  ${qrDataUrl ? `<div style="display:flex;align-items:center;padding:0 10px;"><img src="${qrDataUrl}" style="width:44px;height:44px;" alt="QR" /></div>` : ""}
</div>`;

  return `
<div style="width:336px;height:192px;background:#fdfcf8;border:3px solid #d4cfc9;box-sizing:border-box;
  display:flex;flex-direction:column;font-family:Georgia,serif;overflow:hidden;">
  <div style="background:#5c7f63;padding:7px 14px;display:flex;align-items:center;gap:6px;">
    <span style="font-size:11px;line-height:1;">🌿</span>
    <p style="font-size:9px;font-weight:bold;color:white;margin:0;">${school}</p>
  </div>
  <div style="flex:1;display:flex;flex-direction:row;align-items:center;padding:10px 14px;gap:10px;">
    <div style="flex:1;line-height:1.5;">${addr}${web}${note}</div>
    ${qrDataUrl ? `<img src="${qrDataUrl}" style="width:44px;height:44px;flex-shrink:0;" alt="QR" />` : ""}
  </div>
</div>`;
}

// ─── Card back preview (iframe) ───────────────────────────────────────────────

function CardBackPreview({ style, fields, back, qrDataUrl }: {
  style: StyleId; fields: CardFields; back: BackFields; qrDataUrl: string | null;
}) {
  const W = Math.round(BW * 1.55);
  const H = Math.round(BH * 1.55);
  const sc = W / 336;
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:336px;height:192px;overflow:hidden;}</style></head><body>${cardBackBodyHtml(style, fields, back, qrDataUrl)}</body></html>`;
  return (
    <div style={{ width: W, height: H, overflow: "hidden", flexShrink: 0 }}>
      <iframe srcDoc={srcDoc} style={{ width: 336, height: 192, border: "none", transform: `scale(${sc})`, transformOrigin: "0 0", pointerEvents: "none" }} sandbox="allow-same-origin" title="Card back preview" />
    </div>
  );
}

// ─── Print sheet HTML helpers ─────────────────────────────────────────────────

// 816×1056px (8.5"×11"@96dpi). 2×5 grid. Left margin 72px, top 48px. Card 336×192.
const SHEET_POSITIONS = (() => {
  const positions: { x: number; y: number }[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      positions.push({ x: 72 + col * 336, y: 48 + row * 192 });
    }
  }
  return positions;
})();

// Thin dashed cut-guide lines as divs (more reliable with html2canvas than SVG)
const CUT_GUIDES_HTML = `
  <div style="position:absolute;left:72px;top:0;width:1px;height:1056px;background:repeating-linear-gradient(to bottom,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:408px;top:0;width:1px;height:1056px;background:repeating-linear-gradient(to bottom,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:744px;top:0;width:1px;height:1056px;background:repeating-linear-gradient(to bottom,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:0;top:48px;height:1px;width:816px;background:repeating-linear-gradient(to right,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:0;top:240px;height:1px;width:816px;background:repeating-linear-gradient(to right,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:0;top:432px;height:1px;width:816px;background:repeating-linear-gradient(to right,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:0;top:624px;height:1px;width:816px;background:repeating-linear-gradient(to right,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:0;top:816px;height:1px;width:816px;background:repeating-linear-gradient(to right,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>
  <div style="position:absolute;left:0;top:1008px;height:1px;width:816px;background:repeating-linear-gradient(to right,#ccc 0,#ccc 4px,transparent 4px,transparent 8px);"></div>`;

function buildSheetHtml(cardHtmlFn: () => string): string {
  const cards = SHEET_POSITIONS.map(p =>
    `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:336px;height:192px;overflow:hidden;">${cardHtmlFn()}</div>`
  ).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:816px;height:1056px;overflow:hidden;background:white;}</style>
</head><body><div style="position:relative;width:816px;height:1056px;">${cards}${CUT_GUIDES_HTML}</div></body></html>`;
}

// ─── Card PDF download (html2canvas-based) ────────────────────────────────────

// Renders the card back HTML into an off-screen div and captures it with
// html2canvas. Needed because CardBackPreview uses an iframe (which html2canvas
// cannot cross-capture), while the front card uses a regular React component.
async function downloadCard(
  _frontEl: HTMLElement,
  style: StyleId,
  fields: CardFields,
  _back: BackFields,
  _qrDataUrl: string | null,
  label: string,
) {
  const { jsPDF } = await import("jspdf");
  const { drawIDCardFront } = await import("@/lib/pdf");

  const W = 252, H = 144; // 3.5" × 2" in points
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [W, H] });
  // Convert to inches for our drawing function
  const docIn = new jsPDF({ orientation: "landscape", unit: "in", format: [3.5, 2] });
  drawIDCardFront(docIn, {
    schoolName: fields.schoolName, name: fields.name, title: fields.title,
    schoolYear: fields.schoolYear, state: fields.state, showWatermark: fields.showWatermark,
    style: style as 1 | 2 | 3,
  }, 0, 0);
  docIn.save(`${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`);
}

// ── Print sheet (8 cards per sheet, 2×4 grid, with crop marks) ─────────────
async function downloadPrintSheet(
  _frontEl: HTMLElement,
  style: StyleId,
  fields: CardFields,
  _back: BackFields,
  _qrDataUrl: string | null,
  label: string,
) {
  const { jsPDF } = await import("jspdf");
  const { drawIDCardPrintSheet } = await import("@/lib/pdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
  drawIDCardPrintSheet(doc, {
    schoolName: fields.schoolName, name: fields.name, title: fields.title,
    schoolYear: fields.schoolYear, state: fields.state, showWatermark: fields.showWatermark,
    style: style as 1 | 2 | 3,
  });
  window.open(doc.output("bloburl"), "_blank");
}

// ─── Certificate HTML (letter 8.5"×11") ─────────────────────────────────────

function certBodyHtml(style: StyleId, d: CertDisplay): string {
  const school = d.schoolName || "Family Academy";
  const child  = d.childName  || "Student Name";
  const wm     = d.showWatermark
    ? `<p style="font-size:10px;color:#c4bfb8;margin-top:28px;">Made with Rooted</p>`
    : "";
  const today  = formatDate();

  if (style === 1) return `
<div style="width:816px;height:1056px;background:#fffef8;border:8px solid #2d5a3d;box-sizing:border-box;
  position:relative;font-family:Georgia,'Times New Roman',serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px;">
  <div style="position:absolute;inset:22px;border:2px solid #c4922a;"></div>
  <div style="position:absolute;top:10px;left:10px;width:32px;height:32px;border-top:2px solid #c4922a;border-left:2px solid #c4922a;"></div>
  <div style="position:absolute;top:10px;right:10px;width:32px;height:32px;border-top:2px solid #c4922a;border-right:2px solid #c4922a;"></div>
  <div style="position:absolute;bottom:10px;left:10px;width:32px;height:32px;border-bottom:2px solid #c4922a;border-left:2px solid #c4922a;"></div>
  <div style="position:absolute;bottom:10px;right:10px;width:32px;height:32px;border-bottom:2px solid #c4922a;border-right:2px solid #c4922a;"></div>
  <div style="text-align:center;z-index:1;">
    <p style="font-size:13px;color:#c4922a;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px;">${school}</p>
    <p style="font-size:28px;color:#2d5a3d;letter-spacing:4px;text-transform:uppercase;font-weight:bold;margin:0 0 28px;">${d.certTitle}</p>
    <p style="font-size:16px;color:#7a6f65;font-style:italic;margin:0 0 10px;">This certifies that</p>
    <div style="width:340px;height:1px;background:#c4922a;margin:0 auto 10px;"></div>
    <p style="font-size:52px;font-weight:bold;font-style:italic;color:#2d2926;margin:0 0 10px;line-height:1.1;">${child}</p>
    <div style="width:340px;height:1px;background:#c4922a;margin:0 auto 24px;"></div>
    <p style="font-size:19px;color:#2d2926;margin:0 0 36px;max-width:580px;line-height:1.55;">${d.accomplishment}</p>
    <p style="font-size:13px;color:#7a6f65;letter-spacing:2px;margin:0 0 6px;">✦ &nbsp; ${d.schoolYear} &nbsp; ✦</p>
    <p style="font-size:12px;color:#b5aca4;margin:0;">${today}</p>
    ${wm}
  </div>
</div>`;

  if (style === 2) return `
<div style="width:816px;height:1056px;background:#ffffff;box-sizing:border-box;
  display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;">
  <div style="background:#2d5a3d;padding:52px 60px;text-align:center;">
    <p style="font-size:30px;margin:0 0 10px;line-height:1;">🌿</p>
    <p style="font-size:13px;color:rgba(255,255,255,0.7);font-weight:700;letter-spacing:3px;text-transform:uppercase;margin:0 0 6px;">${school}</p>
    <p style="font-size:36px;color:white;font-weight:900;letter-spacing:6px;text-transform:uppercase;margin:0;">${d.certTitle}</p>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px;text-align:center;">
    <p style="font-size:16px;color:#7a6f65;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin:0 0 14px;">Presented to</p>
    <p style="font-size:62px;font-weight:900;color:#2d2926;line-height:1.05;margin:0 0 20px;">${child}</p>
    <div style="width:80px;height:4px;background:#5c7f63;border-radius:2px;margin:0 auto 28px;"></div>
    <p style="font-size:20px;color:#2d2926;margin:0 0 52px;max-width:560px;line-height:1.5;">${d.accomplishment}</p>
    <p style="font-size:13px;color:#b5aca4;letter-spacing:1px;margin:0 0 6px;">${d.schoolYear}</p>
    <p style="font-size:12px;color:#c4bfb8;margin:0;">${today}</p>
    ${wm}
  </div>
</div>`;

  return `
<div style="width:816px;height:1056px;background:#fdfcf8;box-sizing:border-box;
  display:flex;flex-direction:column;font-family:Georgia,'Times New Roman',serif;overflow:hidden;">
  <div style="background:#5c7f63;padding:40px 60px;display:flex;align-items:center;gap:18px;justify-content:center;">
    <span style="font-size:30px;line-height:1;">🌿</span>
    <div>
      <p style="font-size:14px;color:rgba(255,255,255,0.8);letter-spacing:2px;text-transform:uppercase;margin:0 0 4px;">${school}</p>
      <p style="font-size:24px;font-weight:bold;color:white;margin:0;">${d.certTitle}</p>
    </div>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px;text-align:center;">
    <p style="font-size:15px;color:#7a6f65;font-style:italic;margin:0 0 10px;">This certificate is presented to</p>
    <p style="font-size:54px;font-style:italic;color:#2d2926;margin:0 0 10px;line-height:1.1;">${child}</p>
    <p style="font-size:22px;margin:0 0 24px;">🍃🍃🍃</p>
    <p style="font-size:19px;color:#2d2926;margin:0 0 44px;max-width:560px;line-height:1.6;">${d.accomplishment}</p>
    <div style="width:200px;height:1px;background:#c4bfb8;margin:0 auto 22px;"></div>
    <p style="font-size:13px;color:#7a6f65;margin:0 0 6px;">${d.schoolYear}</p>
    <p style="font-size:12px;color:#b5aca4;margin:0;">${today}</p>
    ${wm}
  </div>
</div>`;
}

// ─── Certificate preview (iframe + CSS scale) ────────────────────────────────

function CertPreview({ style, display }: { style: StyleId; display: CertDisplay }) {
  const scale = 0.22;
  const W = Math.round(CW * scale);
  const H = Math.round(CH * scale);

  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:${CW}px;height:${CH}px;overflow:hidden;}</style>
</head><body>${certBodyHtml(style, display)}</body></html>`;

  return (
    <div style={{ width: W, height: H, overflow: "hidden", flexShrink: 0, borderRadius: 4 }}>
      <iframe
        srcDoc={srcDoc}
        style={{
          width: CW,
          height: CH,
          border: "none",
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
        sandbox="allow-same-origin"
        title="Certificate preview"
      />
    </div>
  );
}

// ─── Certificate PDF download ─────────────────────────────────────────────────

async function downloadCert(style: StyleId, display: CertDisplay, filename: string) {
  const { jsPDF } = await import("jspdf");
  const { generateCertificate } = await import("@/lib/pdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });
  generateCertificate(doc, {
    schoolName: display.schoolName,
    childName: display.childName,
    certTitle: display.certTitle,
    accomplishment: display.accomplishment,
    schoolYear: display.schoolYear,
    showWatermark: display.showWatermark,
    style: style as 1 | 2 | 3,
  });
  doc.save(`${filename.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.pdf`);
}

// ─── Shared form components ──────────────────────────────────────────────────

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

function ChildSelect({ label = "Child", childrenList, value, onChange }: {
  label?: string;
  childrenList: ChildData[];
  value: string;
  onChange: (childId: string, childName: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <select
        value={value}
        onChange={e => {
          const child = childrenList.find(c => c.id === e.target.value);
          onChange(e.target.value, child?.name || "");
        }}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]"
      >
        {childrenList.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

function SelectInput({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TextAreaInput({ label, value, placeholder, onChange }: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        rows={2}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63] resize-none"
      />
    </div>
  );
}

// ─── Photo upload (crops to 4:5 portrait ratio via canvas) ───────────────────

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
        // Crop to 4:5 ratio (portrait), keeping top of image (faces)
        const targetRatio = 4 / 5;
        let cropW = img.width;
        let cropH = img.height;
        let cropX = 0;
        let cropY = 0;
        if (img.width / img.height > targetRatio) {
          cropW = img.height * targetRatio;
          cropX = (img.width - cropW) / 2;
        } else {
          cropH = img.width / targetRatio;
          cropY = 0; // keep top (where face typically is)
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(cropW);
        canvas.height = Math.round(cropH);
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
        {/* Photo box */}
        <div
          onClick={() => !photoUrl && inputRef.current?.click()}
          className={`relative flex-shrink-0 overflow-hidden rounded border-2 flex items-center justify-center transition-colors ${
            photoUrl
              ? "border-[#e8e2d9] w-[72px] h-[90px]"
              : "border-dashed border-[#5c7f63] w-[72px] h-[90px] cursor-pointer hover:border-[#3d5c42] hover:bg-[#f0f7f1]"
          }`}
          style={{ background: photoUrl ? undefined : "#fafef8" }}
        >
          {photoUrl ? (
            <img src={photoUrl} className="w-full h-full object-cover object-top" alt="ID photo" />
          ) : (
            <div className="text-center px-1">
              <p className="text-2xl leading-tight">📷</p>
              <p className="text-[9px] text-[#5c7f63] font-semibold mt-1 leading-tight">Upload photo</p>
            </div>
          )}
        </div>

        {/* Side text + actions */}
        <div className="flex-1 min-w-0 pt-1">
          {!photoUrl ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm font-semibold text-white bg-[#5c7f63] hover:bg-[#3d5c42] px-3 py-1.5 rounded-lg transition-colors"
            >
              📷 Upload photo
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-xs font-semibold text-[#5c7f63] hover:underline"
              >
                Change
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-xs text-[#b5aca4] hover:text-red-400 hover:underline"
              >
                Remove
              </button>
            </div>
          )}
          <p className="text-[11px] text-[#2d2926] font-medium mt-2 leading-relaxed">
            Photo required — most programs require a photo ID to be valid.
          </p>
          <p className="text-[10px] text-[#b5aca4] mt-0.5">JPG or PNG · auto-cropped to portrait</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
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
  const [downloading,      setDownloading]      = useState(false);
  const [downloadingSheet, setDownloadingSheet]  = useState(false);
  const [photoUrl,         setPhotoUrl]          = useState<string | null>(null);
  const [back, setBack] = useState<BackFields>({
    include: false, address: "", websiteOrEmail: "", note: "", includeQR: false,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const frontRef = useRef<HTMLDivElement>(null);

  const set = (key: keyof CardFields, val: string | boolean) => onChange({ ...fields, [key]: val });
  const setBackField = (key: keyof BackFields, val: string | boolean) =>
    setBack(prev => ({ ...prev, [key]: val }));
  const canDownload = !!photoUrl && !!frontRef.current;

  async function handleToggleQR(checked: boolean) {
    if (checked && !qrDataUrl) {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await (QRCode as { toDataURL: (text: string, opts: object) => Promise<string> })
          .toDataURL("https://rootedhomeschoolapp.com", { width: 80, margin: 1 });
        setQrDataUrl(url);
      } catch { /* silently skip QR if generation fails */ }
    }
    setBackField("includeQR", checked);
  }

  async function handleDownload() {
    if (!photoUrl || !frontRef.current) return;
    setDownloading(true);
    try {
      await downloadCard(frontRef.current, style, fields, back, back.includeQR ? qrDataUrl : null, cardLabel);
    } catch (e) {
      console.error(e);
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function handlePrintSheet() {
    if (!photoUrl || !frontRef.current) return;
    setDownloadingSheet(true);
    try {
      await downloadPrintSheet(frontRef.current, style, fields, back, back.includeQR ? qrDataUrl : null, cardLabel);
    } catch (e) {
      console.error(e);
      alert("Download failed. Please try again.");
    } finally {
      setDownloadingSheet(false);
    }
  }

  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#f0ede8] flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-[#2d2926] pt-0.5">{cardLabel}</h3>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={!canDownload || downloading}
              title={!photoUrl ? "Upload a photo to enable download" : undefined}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download size={11} />
              {downloading ? "Generating…" : "Download ID Card"}
            </button>
            <button
              onClick={handlePrintSheet}
              disabled={!canDownload || downloadingSheet}
              title={!photoUrl ? "Upload a photo to enable download" : undefined}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              <span className="text-[11px]">📄</span>
              {downloadingSheet ? "Generating…" : "Print Sheet"}
            </button>
          </div>
          {!photoUrl && (
            <p className="text-[10px] text-[#b5aca4]">Upload a photo to enable download</p>
          )}
          {photoUrl && (
            <p className="text-[10px] text-[#b5aca4] text-right max-w-xs leading-relaxed">
              💡 Print at 100% (do not scale to fit). Page 1 = fronts, Page 2 = backs if double-sided. Cut on the crop marks. Print on cardstock and laminate for best results.
            </p>
          )}
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <PhotoUpload photoUrl={photoUrl} onChange={setPhotoUrl} />
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
            <input type="checkbox" checked={fields.showWatermark}
              onChange={e => set("showWatermark", e.target.checked)}
              className="w-4 h-4 rounded accent-[#5c7f63]" />
            <span className="text-xs text-[#7a6f65]">Include "Made with Rooted" on card</span>
          </label>

          {/* ── Card back toggle ── */}
          <div className="border-t border-[#f0ede8] pt-3 mt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={back.include}
                onChange={e => setBackField("include", e.target.checked)}
                className="w-4 h-4 rounded accent-[#5c7f63]" />
              <span className="text-xs font-semibold text-[#2d2926]">Include card back (double-sided)</span>
            </label>
          </div>

          {back.include && (
            <div className="space-y-2.5 pl-1">
              <FieldInput label="School Address (optional)" value={back.address}
                onChange={v => setBackField("address", v)} />
              <FieldInput label="Website or Email (optional)" value={back.websiteOrEmail}
                onChange={v => setBackField("websiteOrEmail", v)} />
              <FieldInput label="Note (optional)" value={back.note}
                onChange={v => setBackField("note", v)} />
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={back.includeQR}
                  onChange={e => handleToggleQR(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#5c7f63]" />
                <span className="text-xs text-[#7a6f65]">Include QR code linking to rootedhomeschoolapp.com</span>
              </label>
            </div>
          )}
        </div>

        {/* Live previews */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-wide">Front</p>
            <div ref={frontRef} className="shadow-lg rounded overflow-hidden">
              <CardPreview style={style} fields={fields} photoUrl={photoUrl} scale={1.55} />
            </div>
            <p className="text-[10px] text-[#b5aca4]">3.5″ × 2″</p>
          </div>
          {back.include && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-[10px] font-semibold text-[#b5aca4] uppercase tracking-wide">Card Back</p>
              <div className="shadow-lg rounded overflow-hidden">
                <CardBackPreview style={style} fields={fields} back={back} qrDataUrl={back.includeQR ? qrDataUrl : null} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Certificate card wrapper ─────────────────────────────────────────────────

function CertCard({
  icon, title, desc, style, display, onDownload, downloading, children,
}: {
  icon: string;
  title: string;
  desc: string;
  style: StyleId;
  display: CertDisplay;
  onDownload: () => void;
  downloading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-[#f0ede8] flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[#2d2926] flex items-center gap-1.5">
            <span>{icon}</span> {title}
          </p>
          <p className="text-[11px] text-[#b5aca4] mt-0.5">{desc}</p>
        </div>
        <button
          onClick={onDownload}
          disabled={downloading}
          className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0 mt-0.5"
        >
          <Download size={11} />
          {downloading ? "Generating…" : "Download"}
        </button>
      </div>
      <div className="p-4 flex gap-4 flex-1">
        <div className="flex-1 space-y-3 min-w-0">{children}</div>
        <div className="flex flex-col items-center gap-2 shrink-0">
          <p className="text-[9px] font-semibold text-[#b5aca4] uppercase tracking-wide">Preview</p>
          <div className="shadow-md rounded overflow-hidden border border-[#e8e2d9]">
            <CertPreview style={style} display={display} />
          </div>
          <p className="text-[9px] text-[#c4bfb8]">8.5″ × 11″</p>
        </div>
      </div>
    </div>
  );
}

// ─── Annual report card section ───────────────────────────────────────────────

function AnnualReportCard({
  childrenList, schoolName, schoolYear, showWatermark, setShowWatermark,
}: {
  childrenList: ChildData[];
  schoolName: string;
  schoolYear: string;
  showWatermark: boolean;
  setShowWatermark: (v: boolean) => void;
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
        <div>
          <h3 className="text-sm font-bold text-[#2d2926]">📊 Progress Report</h3>
          <p className="text-[11px] text-[#b5aca4] mt-0.5">Full-year record with lessons, hours, books, activities, and daily log for state compliance</p>
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading || childrenList.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors shrink-0"
        >
          <Download size={12} />
          {downloading ? "Generating…" : "Download Report"}
        </button>
      </div>
      <div className="px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="text-sm text-[#7a6f65]">
          <span className="font-semibold text-[#2d2926]">{childrenList.length}</span>{" "}
          {childrenList.length === 1 ? "student" : "students"} · {schoolYear}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none ml-auto">
          <input
            type="checkbox"
            checked={showWatermark}
            onChange={e => setShowWatermark(e.target.checked)}
            className="w-4 h-4 rounded accent-[#5c7f63]"
          />
          <span className="text-xs text-[#7a6f65]">Include "Made with Rooted" watermark</span>
        </label>
      </div>
      {childrenList.length === 0 && (
        <p className="px-5 pb-4 text-sm text-[#b5aca4] italic">
          Add children in Settings to generate a report card.
        </p>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PrintablesPage() {
  const partnerCtx = usePartner();
  const [activeStyle, setActiveStyle] = useState<StyleId>(1);
  const [isPro,       setIsPro]       = useState<boolean | null>(null);
  const [familyName,  setFamilyName]  = useState("");
  const [stateCode,   setStateCode]   = useState("");
  const [children,    setChildren]    = useState<ChildData[]>([]);
  const [parentFields, setParentFields] = useState<CardFields | null>(null);
  const [childFields,  setChildFields]  = useState<Record<string, CardFields>>({});
  const [reportWatermark, setReportWatermark] = useState(true);

  // ─── Cert states ──────────────────────────────────────────────────────────
  const [gradCert,      setGradCert]      = useState<GradCert | null>(null);
  const [subjectCert,   setSubjectCert]   = useState<SubjectCert | null>(null);
  const [streakCert,    setStreakCert]     = useState<StreakCert | null>(null);
  const [gardenCert,    setGardenCert]    = useState<GardenCert | null>(null);
  const [bookCert,      setBookCert]      = useState<BookCert | null>(null);
  const [perfWeekCert,  setPerfWeekCert]  = useState<PerfWeekCert | null>(null);
  const [downloadingCert, setDownloadingCert] = useState<string | null>(null);

  useEffect(() => { document.title = "Printables \u00b7 Rooted"; }, []);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const uid = partnerCtx.effectiveUserId || session.user.id;

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, state, is_pro")
        .eq("id", uid)
        .maybeSingle();

      const fName = (profile as { display_name?: string } | null)?.display_name || "";
      const st    = (profile as { state?: string }         | null)?.state        || "";
      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
      setFamilyName(fName);
      setStateCode(st);
      setParentFields(makeParentDefaults(fName, st));

      // Fetch children (leaves/streak are not stored columns — computed below)
      const { data: kids } = await supabase
        .from("children")
        .select("id, name")
        .eq("user_id", uid)
        .eq("archived", false)
        .order("sort_order");

      // Fetch completed lessons for leaf count + streak computation
      const [{ data: completedLessons }, { data: bookEvents }] = await Promise.all([
        supabase.from("lessons").select("child_id, date").eq("user_id", uid).eq("completed", true),
        supabase.from("app_events").select("payload").eq("user_id", uid).eq("type", "book_read"),
      ]);

      // Leaf count = completed lessons + book_read events (mirrors garden page)
      const leafMap: Record<string, number> = {};
      for (const l of (completedLessons || []) as { child_id: string }[]) {
        leafMap[l.child_id] = (leafMap[l.child_id] || 0) + 1;
      }
      for (const e of (bookEvents || []) as { payload: { child_id?: string } }[]) {
        const cid = e.payload?.child_id;
        if (cid) leafMap[cid] = (leafMap[cid] || 0) + 1;
      }

      // Per-child lesson dates for streak computation
      const childDatesMap: Record<string, Set<string>> = {};
      for (const l of (completedLessons || []) as { child_id: string; date?: string }[]) {
        if (!l.date) continue;
        if (!childDatesMap[l.child_id]) childDatesMap[l.child_id] = new Set();
        childDatesMap[l.child_id].add(l.date);
      }

      function computeStreak(dates: Set<string>): number {
        let streak = 0;
        const todayStr = (d: Date) => d.toISOString().slice(0, 10);
        const cursor = new Date();
        cursor.setHours(0, 0, 0, 0);
        const tmp = new Date(cursor);
        while (dates.has(todayStr(tmp))) { streak++; tmp.setDate(tmp.getDate() - 1); }
        if (streak === 0) {
          cursor.setDate(cursor.getDate() - 1);
          while (dates.has(todayStr(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
        }
        return streak;
      }

      const kidsArr: ChildData[] = (kids || []).map((k: { id: string; name: string }) => ({
        id: k.id,
        name: k.name,
        leaves: leafMap[k.id] || 0,
        streak: computeStreak(childDatesMap[k.id] || new Set()),
      }));
      setChildren(kidsArr);

      const cardMap: Record<string, CardFields> = {};
      for (const kid of kidsArr) {
        cardMap[kid.id] = makeChildDefaults(kid.name, fName, st);
      }
      setChildFields(cardMap);

      // Init cert states with first child (if any)
      const firstChild = kidsArr[0];
      const school = fName ? `${fName} Academy` : "Family Academy";
      const yr = currentYearRange();

      if (firstChild) {
        setGradCert({ childId: firstChild.id, childName: firstChild.name, schoolName: school, schoolYear: yr, gradeLevel: "Kindergarten", certText: "", showWatermark: true });
        setSubjectCert({ childId: firstChild.id, childName: firstChild.name, schoolName: school, schoolYear: yr, subjectName: "", certText: "", showWatermark: true });
        setStreakCert({ childId: firstChild.id, childName: firstChild.name, schoolName: school, schoolYear: yr, streakCount: String(firstChild.streak || 0), certText: "", showWatermark: true });
        const stage = stageNameFromLeaves(firstChild.leaves || 0);
        setGardenCert({ childId: firstChild.id, childName: firstChild.name, schoolName: school, schoolYear: yr, leafCount: String(firstChild.leaves || 0), stageName: stage, certText: "", showWatermark: true });
        setBookCert({ childId: firstChild.id, childName: firstChild.name, schoolName: school, schoolYear: yr, bookTitle: "", certText: "", showWatermark: true });
        setPerfWeekCert({ childId: firstChild.id, childName: firstChild.name, schoolName: school, schoolYear: yr, dateRange: "", certText: "", showWatermark: true });
      } else {
        setGradCert({ childId: "", childName: "Student Name", schoolName: school, schoolYear: yr, gradeLevel: "Kindergarten", certText: "", showWatermark: true });
        setSubjectCert({ childId: "", childName: "Student Name", schoolName: school, schoolYear: yr, subjectName: "", certText: "", showWatermark: true });
        setStreakCert({ childId: "", childName: "Student Name", schoolName: school, schoolYear: yr, streakCount: "30", certText: "", showWatermark: true });
        setGardenCert({ childId: "", childName: "Student Name", schoolName: school, schoolYear: yr, leafCount: "50", stageName: "Young Tree", certText: "", showWatermark: true });
        setBookCert({ childId: "", childName: "Student Name", schoolName: school, schoolYear: yr, bookTitle: "", certText: "", showWatermark: true });
        setPerfWeekCert({ childId: "", childName: "Student Name", schoolName: school, schoolYear: yr, dateRange: "", certText: "", showWatermark: true });
      }
    }
    load();
  }, [partnerCtx.effectiveUserId]);

  const updateChildField = useCallback((id: string, f: CardFields) => {
    setChildFields(prev => ({ ...prev, [id]: f }));
  }, []);

  const sampleFields: CardFields = {
    schoolName: familyName ? `${familyName} Academy` : "Family Academy",
    name: "Sample Name",
    title: "Student",
    schoolYear: currentYearRange(),
    state: stateCode || "NV",
    showWatermark: false,
  };

  // ─── Cert display builders ──────────────────────────────────────────────
  function gradDisplay(): CertDisplay {
    if (!gradCert) return { schoolName: "", childName: "", certTitle: "Graduation Certificate", accomplishment: "", schoolYear: "", showWatermark: true };
    return {
      schoolName: gradCert.schoolName,
      childName: gradCert.childName || "Student Name",
      certTitle: "Graduation Certificate",
      accomplishment: gradCert.certText || `has successfully completed ${gradCert.gradeLevel || "this grade level"} at ${gradCert.schoolName || "Family Academy"}`,
      schoolYear: gradCert.schoolYear,
      showWatermark: gradCert.showWatermark,
    };
  }
  function subjectDisplay(): CertDisplay {
    if (!subjectCert) return { schoolName: "", childName: "", certTitle: "Certificate of Completion", accomplishment: "", schoolYear: "", showWatermark: true };
    return {
      schoolName: subjectCert.schoolName,
      childName: subjectCert.childName || "Student Name",
      certTitle: "Certificate of Completion",
      accomplishment: subjectCert.certText || `has successfully completed ${subjectCert.subjectName || "the course"}`,
      schoolYear: subjectCert.schoolYear,
      showWatermark: subjectCert.showWatermark,
    };
  }
  function streakDisplay(): CertDisplay {
    if (!streakCert) return { schoolName: "", childName: "", certTitle: "Learning Streak Award", accomplishment: "", schoolYear: "", showWatermark: true };
    return {
      schoolName: streakCert.schoolName,
      childName: streakCert.childName || "Student Name",
      certTitle: "Learning Streak Award",
      accomplishment: streakCert.certText || `achieved an incredible ${streakCert.streakCount || "30"}-day learning streak!`,
      schoolYear: streakCert.schoolYear,
      showWatermark: streakCert.showWatermark,
    };
  }
  function gardenDisplay(): CertDisplay {
    if (!gardenCert) return { schoolName: "", childName: "", certTitle: "Garden Milestone Award", accomplishment: "", schoolYear: "", showWatermark: true };
    return {
      schoolName: gardenCert.schoolName,
      childName: gardenCert.childName || "Student Name",
      certTitle: "Garden Milestone Award",
      accomplishment: gardenCert.certText || `reached ${gardenCert.stageName || "Young Tree"} with ${gardenCert.leafCount || "50"} lessons completed!`,
      schoolYear: gardenCert.schoolYear,
      showWatermark: gardenCert.showWatermark,
    };
  }
  function bookDisplay(): CertDisplay {
    if (!bookCert) return { schoolName: "", childName: "", certTitle: "Reading Certificate", accomplishment: "", schoolYear: "", showWatermark: true };
    return {
      schoolName: bookCert.schoolName,
      childName: bookCert.childName || "Student Name",
      certTitle: "Reading Certificate",
      accomplishment: bookCert.certText || `finished reading ${bookCert.bookTitle || "a wonderful book"}`,
      schoolYear: bookCert.schoolYear,
      showWatermark: bookCert.showWatermark,
    };
  }
  function perfWeekDisplay(): CertDisplay {
    if (!perfWeekCert) return { schoolName: "", childName: "", certTitle: "Perfect Week Award", accomplishment: "", schoolYear: "", showWatermark: true };
    const dateNote = perfWeekCert.dateRange ? ` (${perfWeekCert.dateRange})` : "";
    return {
      schoolName: perfWeekCert.schoolName,
      childName: perfWeekCert.childName || "Student Name",
      certTitle: "Perfect Week Award",
      accomplishment: perfWeekCert.certText || `completed a perfect week of learning!${dateNote}`,
      schoolYear: perfWeekCert.schoolYear,
      showWatermark: perfWeekCert.showWatermark,
    };
  }

  async function handleCertDownload(certId: string, display: CertDisplay) {
    setDownloadingCert(certId);
    try {
      const filename = `${(display.childName || "student").replace(/\s+/g, "-").toLowerCase()}-${certId}`;
      await downloadCert(activeStyle, display, filename);
    } catch (e) {
      console.error(e);
      alert("Download failed. Please try again.");
    } finally {
      setDownloadingCert(null);
    }
  }

  const certsReady = gradCert !== null;
  const schoolName = familyName ? `${familyName} Academy` : "Family Academy";

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
            Homeschool ID cards are provided as a convenience tool and require a photo to be considered valid.
            Rooted does not guarantee acceptance at any discount program, retailer, or institution.
            Always verify a program&apos;s homeschool verification requirements before applying.
          </p>
        </div>

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

      {/* ── Certificates ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">🎓 Certificates</h2>
        <p className="text-xs text-[#b5aca4] mb-4">
          Achievement and completion certificates — styled to match your chosen card style.
        </p>

        {!certsReady ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-6 py-8 flex items-center justify-center">
            <span className="text-2xl animate-pulse">🌿</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* 1. Graduation */}
            {gradCert && (
              <CertCard
                icon="🎓" title="Graduation Certificate"
                desc="Celebrate completing a grade level"
                style={activeStyle} display={gradDisplay()}
                onDownload={() => handleCertDownload("graduation", gradDisplay())}
                downloading={downloadingCert === "graduation"}
              >
                {children.length > 0 && (
                  <ChildSelect
                    childrenList={children} value={gradCert.childId}
                    onChange={(id, name) => setGradCert(p => p ? { ...p, childId: id, childName: name } : p)}
                  />
                )}
                <SelectInput
                  label="Grade Level" value={gradCert.gradeLevel} options={GRADES}
                  onChange={v => setGradCert(p => p ? { ...p, gradeLevel: v } : p)}
                />
                <FieldInput
                  label="School Year" value={gradCert.schoolYear}
                  onChange={v => setGradCert(p => p ? { ...p, schoolYear: v } : p)}
                />
                <TextAreaInput
                  label="Custom Text (optional)"
                  value={gradCert.certText}
                  placeholder={`has successfully completed ${gradCert.gradeLevel} at ${gradCert.schoolName || "Family Academy"}`}
                  onChange={v => setGradCert(p => p ? { ...p, certText: v } : p)}
                />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={gradCert.showWatermark}
                    onChange={e => setGradCert(p => p ? { ...p, showWatermark: e.target.checked } : p)}
                    className="w-4 h-4 rounded accent-[#5c7f63]" />
                  <span className="text-xs text-[#7a6f65]">Include watermark</span>
                </label>
              </CertCard>
            )}

            {/* 2. Subject Completion */}
            {subjectCert && (
              <CertCard
                icon="📚" title="Subject Completion"
                desc="Recognize finishing a subject or course"
                style={activeStyle} display={subjectDisplay()}
                onDownload={() => handleCertDownload("subject-completion", subjectDisplay())}
                downloading={downloadingCert === "subject-completion"}
              >
                {children.length > 0 && (
                  <ChildSelect
                    childrenList={children} value={subjectCert.childId}
                    onChange={(id, name) => setSubjectCert(p => p ? { ...p, childId: id, childName: name } : p)}
                  />
                )}
                <FieldInput
                  label="Subject Name" value={subjectCert.subjectName}
                  onChange={v => setSubjectCert(p => p ? { ...p, subjectName: v } : p)}
                />
                <FieldInput
                  label="School Year" value={subjectCert.schoolYear}
                  onChange={v => setSubjectCert(p => p ? { ...p, schoolYear: v } : p)}
                />
                <TextAreaInput
                  label="Custom Text (optional)"
                  value={subjectCert.certText}
                  placeholder={`has successfully completed ${subjectCert.subjectName || "the subject"}`}
                  onChange={v => setSubjectCert(p => p ? { ...p, certText: v } : p)}
                />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={subjectCert.showWatermark}
                    onChange={e => setSubjectCert(p => p ? { ...p, showWatermark: e.target.checked } : p)}
                    className="w-4 h-4 rounded accent-[#5c7f63]" />
                  <span className="text-xs text-[#7a6f65]">Include watermark</span>
                </label>
              </CertCard>
            )}

            {/* 3. Streak Milestone */}
            {streakCert && (
              <CertCard
                icon="🔥" title="Streak Milestone"
                desc="Celebrate a daily learning streak"
                style={activeStyle} display={streakDisplay()}
                onDownload={() => handleCertDownload("streak-milestone", streakDisplay())}
                downloading={downloadingCert === "streak-milestone"}
              >
                {children.length > 0 && (
                  <ChildSelect
                    childrenList={children} value={streakCert.childId}
                    onChange={(id, name) => {
                      const child = children.find(c => c.id === id);
                      setStreakCert(p => p ? { ...p, childId: id, childName: name, streakCount: String(child?.streak || 0) } : p);
                    }}
                  />
                )}
                <FieldInput
                  label="Streak Count (days)" value={streakCert.streakCount}
                  onChange={v => setStreakCert(p => p ? { ...p, streakCount: v } : p)}
                />
                <FieldInput
                  label="School Year" value={streakCert.schoolYear}
                  onChange={v => setStreakCert(p => p ? { ...p, schoolYear: v } : p)}
                />
                <TextAreaInput
                  label="Custom Text (optional)"
                  value={streakCert.certText}
                  placeholder={`achieved an incredible ${streakCert.streakCount || "30"}-day learning streak!`}
                  onChange={v => setStreakCert(p => p ? { ...p, certText: v } : p)}
                />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={streakCert.showWatermark}
                    onChange={e => setStreakCert(p => p ? { ...p, showWatermark: e.target.checked } : p)}
                    className="w-4 h-4 rounded accent-[#5c7f63]" />
                  <span className="text-xs text-[#7a6f65]">Include watermark</span>
                </label>
              </CertCard>
            )}

            {/* 4. Garden Milestone */}
            {gardenCert && (
              <CertCard
                icon="🌳" title="Garden Milestone"
                desc="Celebrate reaching a new garden stage"
                style={activeStyle} display={gardenDisplay()}
                onDownload={() => handleCertDownload("garden-milestone", gardenDisplay())}
                downloading={downloadingCert === "garden-milestone"}
              >
                {children.length > 0 && (
                  <ChildSelect
                    childrenList={children} value={gardenCert.childId}
                    onChange={(id, name) => {
                      const child = children.find(c => c.id === id);
                      const stage = stageNameFromLeaves(child?.leaves || 0);
                      setGardenCert(p => p ? { ...p, childId: id, childName: name, leafCount: String(child?.leaves || 0), stageName: stage } : p);
                    }}
                  />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <FieldInput
                    label="Leaf Count" value={gardenCert.leafCount}
                    onChange={v => setGardenCert(p => p ? { ...p, leafCount: v, stageName: stageNameFromLeaves(parseInt(v) || 0) } : p)}
                  />
                  <FieldInput
                    label="Stage Name" value={gardenCert.stageName}
                    onChange={v => setGardenCert(p => p ? { ...p, stageName: v } : p)}
                  />
                </div>
                <FieldInput
                  label="School Year" value={gardenCert.schoolYear}
                  onChange={v => setGardenCert(p => p ? { ...p, schoolYear: v } : p)}
                />
                <TextAreaInput
                  label="Custom Text (optional)"
                  value={gardenCert.certText}
                  placeholder={`reached ${gardenCert.stageName} with ${gardenCert.leafCount} lessons completed!`}
                  onChange={v => setGardenCert(p => p ? { ...p, certText: v } : p)}
                />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={gardenCert.showWatermark}
                    onChange={e => setGardenCert(p => p ? { ...p, showWatermark: e.target.checked } : p)}
                    className="w-4 h-4 rounded accent-[#5c7f63]" />
                  <span className="text-xs text-[#7a6f65]">Include watermark</span>
                </label>
              </CertCard>
            )}

            {/* 5. Book Certificate */}
            {bookCert && (
              <CertCard
                icon="📖" title="Book Certificate"
                desc="Celebrate finishing a book"
                style={activeStyle} display={bookDisplay()}
                onDownload={() => handleCertDownload("book-certificate", bookDisplay())}
                downloading={downloadingCert === "book-certificate"}
              >
                {children.length > 0 && (
                  <ChildSelect
                    childrenList={children} value={bookCert.childId}
                    onChange={(id, name) => setBookCert(p => p ? { ...p, childId: id, childName: name } : p)}
                  />
                )}
                <FieldInput
                  label="Book Title" value={bookCert.bookTitle}
                  onChange={v => setBookCert(p => p ? { ...p, bookTitle: v } : p)}
                />
                <FieldInput
                  label="School Year" value={bookCert.schoolYear}
                  onChange={v => setBookCert(p => p ? { ...p, schoolYear: v } : p)}
                />
                <TextAreaInput
                  label="Custom Text (optional)"
                  value={bookCert.certText}
                  placeholder={`finished reading ${bookCert.bookTitle || "a wonderful book"}`}
                  onChange={v => setBookCert(p => p ? { ...p, certText: v } : p)}
                />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={bookCert.showWatermark}
                    onChange={e => setBookCert(p => p ? { ...p, showWatermark: e.target.checked } : p)}
                    className="w-4 h-4 rounded accent-[#5c7f63]" />
                  <span className="text-xs text-[#7a6f65]">Include watermark</span>
                </label>
              </CertCard>
            )}

            {/* 6. Perfect Week */}
            {perfWeekCert && (
              <CertCard
                icon="⭐" title="Perfect Week Award"
                desc="Celebrate completing every day in a week"
                style={activeStyle} display={perfWeekDisplay()}
                onDownload={() => handleCertDownload("perfect-week", perfWeekDisplay())}
                downloading={downloadingCert === "perfect-week"}
              >
                {children.length > 0 && (
                  <ChildSelect
                    childrenList={children} value={perfWeekCert.childId}
                    onChange={(id, name) => setPerfWeekCert(p => p ? { ...p, childId: id, childName: name } : p)}
                  />
                )}
                <FieldInput
                  label="Date Range (optional)" value={perfWeekCert.dateRange}
                  onChange={v => setPerfWeekCert(p => p ? { ...p, dateRange: v } : p)}
                />
                <FieldInput
                  label="School Year" value={perfWeekCert.schoolYear}
                  onChange={v => setPerfWeekCert(p => p ? { ...p, schoolYear: v } : p)}
                />
                <TextAreaInput
                  label="Custom Text (optional)"
                  value={perfWeekCert.certText}
                  placeholder={`completed a perfect week of learning!${perfWeekCert.dateRange ? ` (${perfWeekCert.dateRange})` : ""}`}
                  onChange={v => setPerfWeekCert(p => p ? { ...p, certText: v } : p)}
                />
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={perfWeekCert.showWatermark}
                    onChange={e => setPerfWeekCert(p => p ? { ...p, showWatermark: e.target.checked } : p)}
                    className="w-4 h-4 rounded accent-[#5c7f63]" />
                  <span className="text-xs text-[#7a6f65]">Include watermark</span>
                </label>
              </CertCard>
            )}

          </div>
        )}
      </section>

      {/* ── Progress Report ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-[#2d2926] mb-0.5">📊 Progress Report</h2>
        <p className="text-xs text-[#b5aca4] mb-4">
          Download a full record of lessons, hours, and progress.
        </p>
        <AnnualReportCard
          childrenList={children}
          schoolName={schoolName}
          schoolYear={currentYearRange()}
          showWatermark={reportWatermark}
          setShowWatermark={setReportWatermark}
        />
      </section>

    </div>
  );
}
