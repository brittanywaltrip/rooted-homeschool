"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import { posthog } from "@/lib/posthog";
import { compressImage } from "@/lib/compress-image";
import {
  FIRST_DAY_THEMES,
  DEFAULT_FIRST_DAY_THEME,
  FIRST_DAY_BRANDING,
  type FirstDayFieldKey,
} from "@/lib/first-day-themes";
import { renderFirstDayFrame, type PhotoTransform } from "@/lib/first-day-canvas";

// Mirrors the GRADES list + year-range helper on the printables hub. Kept local
// so the only edit to printables/page.tsx stays "add one card".
const GRADES = [
  "Kindergarten", "1st Grade", "2nd Grade", "3rd Grade", "4th Grade",
  "5th Grade", "6th Grade", "7th Grade", "8th Grade", "9th Grade",
  "10th Grade", "11th Grade", "12th Grade",
];

function currentYearRange(): string {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() < 7 ? `${y - 1}–${y}` : `${y}–${y + 1}`;
}

type Values = Record<FirstDayFieldKey, string>;

interface ChildRow {
  id: string;
  name: string;
  grade_level: string | null;
}

const FIELD_LABELS: Record<FirstDayFieldKey, string> = {
  name: "Name",
  grade: "Grade level",
  year: "Year",
  age: "Age",
  subject: "Favorite subject",
  goal: "Goal this year",
};

function sanitizeFilename(s: string): string {
  return (s || "first-day").replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
}

export default function FirstDayFrameEditor() {
  const partnerCtx = usePartner();
  const theme = FIRST_DAY_THEMES[DEFAULT_FIRST_DAY_THEME];

  const [children, setChildren] = useState<ChildRow[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [photoSrc, setPhotoSrc] = useState<string | null>(null);
  const [photoNat, setPhotoNat] = useState<{ w: number; h: number } | null>(null);
  const [transform, setTransform] = useState<PhotoTransform>({ offsetXPct: 0, offsetYPct: 0, zoom: 1 });
  const [values, setValues] = useState<Values>({
    name: "", grade: "", year: currentYearRange(), age: "", subject: "", goal: "",
  });
  const [busy, setBusy] = useState<"share" | "download" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = useState(0);

  // ── Load children for autofill ─────────────────────────────────────────────
  useEffect(() => {
    document.title = "First Day Photo, Rooted";
    posthog.capture("page_viewed", { page: "first_day_photo" });
  }, []);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = partnerCtx.effectiveUserId || session.user.id;
      const { data: kids } = await supabase
        .from("children")
        .select("id, name, grade_level")
        .eq("user_id", uid)
        .eq("archived", false)
        .order("sort_order");
      const rows = (kids || []) as ChildRow[];
      setChildren(rows);
      if (rows[0]) applyChild(rows[0]);
    }
    load();
  }, [partnerCtx.effectiveUserId]);

  function applyChild(child: ChildRow) {
    setSelectedChildId(child.id);
    setValues((prev) => ({
      ...prev,
      name: child.name || prev.name,
      grade: child.grade_level && GRADES.includes(child.grade_level) ? child.grade_level : prev.grade,
      year: prev.year || currentYearRange(),
    }));
  }

  // ── Measure the preview so geometry + fonts stay WYSIWYG at any size ────────
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const measure = () => setPreviewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Photo upload (reuses compress-image) ───────────────────────────────────
  async function handleFile(file: File) {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
      setToast("Please choose a JPG or PNG photo.");
      setTimeout(() => setToast(null), 4000);
      return;
    }
    const compressed = await compressImage(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        setPhotoNat({ w: img.width, h: img.height });
        setPhotoSrc(src);
        setTransform({ offsetXPct: 0, offsetYPct: 0, zoom: 1 });
      };
      img.src = src;
    };
    reader.readAsDataURL(compressed);
  }

  const setValue = (key: FirstDayFieldKey, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  // ── Preview geometry (mirrors first-day-canvas math) ───────────────────────
  const containerH = previewW * (theme.naturalHeight / theme.naturalWidth);
  const box = useMemo(() => ({
    left: theme.arch.xPct * previewW,
    top: theme.arch.yPct * containerH,
    w: theme.arch.wPct * previewW,
    h: theme.arch.hPct * containerH,
  }), [previewW, containerH, theme]);

  const photoStyle = useMemo(() => {
    if (!photoNat || box.w === 0) return null;
    const coverScale = Math.max(box.w / photoNat.w, box.h / photoNat.h) * Math.max(1, transform.zoom);
    const drawW = photoNat.w * coverScale;
    const drawH = photoNat.h * coverScale;
    const left = (box.w - drawW) / 2 + transform.offsetXPct * box.w;
    const top = (box.h - drawH) / 2 + transform.offsetYPct * box.h;
    return { width: drawW, height: drawH, left, top } as const;
  }, [photoNat, box, transform]);

  // ── Drag to reposition the photo within the arch ───────────────────────────
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (!photoSrc) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: transform.offsetXPct, oy: transform.offsetYPct };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || box.w === 0) return;
    const dx = (e.clientX - drag.current.startX) / box.w;
    const dy = (e.clientY - drag.current.startY) / box.h;
    const clamp = (n: number) => Math.max(-0.5, Math.min(0.5, n));
    setTransform((t) => ({ ...t, offsetXPct: clamp(drag.current!.ox + dx), offsetYPct: clamp(drag.current!.oy + dy) }));
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  // ── Export / Share ─────────────────────────────────────────────────────────
  async function buildBlob(): Promise<Blob> {
    return renderFirstDayFrame({ theme, photoSrc: photoSrc!, transform, values });
  }

  async function handleShare() {
    if (!photoSrc || busy) return;
    setBusy("share");
    try {
      const blob = await buildBlob();
      const file = new File([blob], `${sanitizeFilename(values.name)}-first-day.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: "First Day Photo",
          text: "Our first day, made with Rooted Homeschool App.",
        } as ShareData);
        posthog.capture("first_day_photo_shared");
      } else {
        // No file-share support (most desktop browsers) — fall back to download.
        triggerDownload(blob);
        posthog.capture("first_day_photo_exported", { via: "share_fallback" });
        setToast("Saved the photo. Sharing isn't supported on this device.");
        setTimeout(() => setToast(null), 4000);
      }
    } catch (err) {
      // navigator.share throws AbortError when the user cancels — ignore that.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("[first-day] share failed:", err);
        setToast("Couldn't share. Please try Download instead.");
        setTimeout(() => setToast(null), 4000);
      }
    } finally {
      setBusy(null);
    }
  }

  function triggerDownload(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(values.name)}-first-day.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    if (!photoSrc || busy) return;
    setBusy("download");
    try {
      const blob = await buildBlob();
      triggerDownload(blob);
      posthog.capture("first_day_photo_exported", { via: "download" });
    } catch (err) {
      console.error("[first-day] download failed:", err);
      setToast("Couldn't create the image. Please try again.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setBusy(null);
    }
  }

  const ready = !!photoSrc;

  return (
    <>
      <PageHero
        overline="Your Family's"
        title="First Day Photo"
        subtitle="Add a photo, fill in the details, then share a keepsake of their first day."
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Editor column ── */}
          <div className="space-y-5 order-2 lg:order-1">
            {/* Photo */}
            <div>
              <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-2">
                Photo <span className="text-red-400 font-bold">*</span>
              </label>
              {!photoSrc ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-2xl border-2 border-dashed border-[#5c7f63] bg-[#fafef8] hover:bg-[#f0f7f1] transition-colors py-8 flex flex-col items-center gap-2"
                >
                  <span className="text-3xl">📷</span>
                  <span className="text-sm font-semibold text-[#2D5A3D]">Upload or take a photo</span>
                  <span className="text-[11px] text-[#b5aca4]">JPG or PNG</span>
                </button>
              ) : (
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="text-sm font-semibold text-white bg-[#2D5A3D] hover:opacity-90 px-3 py-1.5 rounded-lg transition-colors">
                    Change photo
                  </button>
                  <button type="button" onClick={() => { setPhotoSrc(null); setPhotoNat(null); }}
                    className="text-xs text-[#b5aca4] hover:text-red-400 hover:underline">
                    Remove
                  </button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </div>

            {/* Reposition / zoom */}
            {photoSrc && (
              <div>
                <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">
                  Adjust photo
                </label>
                <p className="text-[11px] text-[#b5aca4] mb-2">Drag the photo in the preview to reposition. Slide to zoom.</p>
                <input
                  type="range" min={1} max={3} step={0.01} value={transform.zoom}
                  onChange={(e) => setTransform((t) => ({ ...t, zoom: parseFloat(e.target.value) }))}
                  className="w-full accent-[#5c7f63]"
                  aria-label="Zoom"
                />
              </div>
            )}

            {/* Child picker */}
            {children.length > 0 && (
              <div>
                <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">Child</label>
                <select
                  value={selectedChildId}
                  onChange={(e) => { const c = children.find((k) => k.id === e.target.value); if (c) applyChild(c); }}
                  className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]"
                >
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {/* Fields */}
            <div className="grid grid-cols-2 gap-3">
              <TextField label={FIELD_LABELS.name} value={values.name} onChange={(v) => setValue("name", v)} placeholder="e.g. Emma" />
              <div>
                <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{FIELD_LABELS.grade}</label>
                <select value={values.grade} onChange={(e) => setValue("grade", e.target.value)}
                  className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]">
                  <option value="">Select…</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <TextField label={FIELD_LABELS.year} value={values.year} onChange={(v) => setValue("year", v)} placeholder={currentYearRange()} />
              <TextField label={FIELD_LABELS.age} value={values.age} onChange={(v) => setValue("age", v)} placeholder="e.g. 6" />
              <TextField label={FIELD_LABELS.subject} value={values.subject} onChange={(v) => setValue("subject", v)} placeholder="e.g. Reading" />
              <TextField label={FIELD_LABELS.goal} value={values.goal} onChange={(v) => setValue("goal", v)} placeholder="e.g. Read a chapter book" />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button" onClick={handleShare} disabled={!ready || busy !== null}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold text-white bg-[#2D5A3D] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Share2 size={15} /> {busy === "share" ? "Preparing…" : "Share"}
              </button>
              <button
                type="button" onClick={handleDownload} disabled={!ready || busy !== null}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium text-[#5c7f63] border border-[#e8e2d9] bg-white hover:bg-[#f0ede8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={15} /> {busy === "download" ? "Generating…" : "Download PNG"}
              </button>
              <p className="text-[11px] text-[#b5aca4] text-center">Free to share. Every image carries {FIRST_DAY_BRANDING}.</p>
            </div>
          </div>

          {/* ── Live preview column ── */}
          <div className="order-1 lg:order-2">
            <div
              ref={previewRef}
              className="relative w-full max-w-[360px] mx-auto rounded-xl overflow-hidden shadow-lg select-none bg-[#f3efe7]"
              style={{ aspectRatio: `${theme.naturalWidth} / ${theme.naturalHeight}` }}
            >
              {/* Photo behind the arch */}
              <div className="absolute overflow-hidden" style={{ left: box.left, top: box.top, width: box.w, height: box.h }}>
                {photoSrc && photoStyle ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoSrc} alt="" draggable={false}
                    style={{ position: "absolute", left: photoStyle.left, top: photoStyle.top, width: photoStyle.width, height: photoStyle.height, maxWidth: "none" }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#b9c4b2] text-3xl">📷</div>
                )}
              </div>

              {/* Frame art on top */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={theme.src} alt="First Day Photo frame" className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Values on their lines */}
              {previewW > 0 && theme.fields.map((f) => {
                const text = values[f.key]?.trim();
                if (!text) return null;
                return (
                  <span
                    key={f.key}
                    className="absolute pointer-events-none whitespace-nowrap"
                    style={{
                      left: f.xPct * previewW,
                      top: f.yPct * containerH,
                      transform: `translate(${f.align === "center" ? "-50%" : f.align === "right" ? "-100%" : "0"}, -100%)`,
                      fontFamily: `"${theme.fontFamily}", Georgia, serif`,
                      fontSize: f.fontPx * (previewW / theme.naturalWidth),
                      color: theme.textColor,
                      lineHeight: 1,
                    }}
                  >
                    {text}
                  </span>
                );
              })}

              {/* Branding footer (WYSIWYG with the export) */}
              {previewW > 0 && (
                <span
                  className="absolute pointer-events-none whitespace-nowrap"
                  style={{
                    left: "50%", top: 0.972 * containerH, transform: "translate(-50%, -100%)",
                    fontFamily: `"${theme.fontFamily}", Georgia, serif`,
                    fontSize: 0.02 * previewW, color: "#9aa896", lineHeight: 1,
                  }}
                >
                  {FIRST_DAY_BRANDING}
                </span>
              )}

              {/* Drag layer over the arch (captures pan) */}
              {photoSrc && (
                <div
                  className="absolute"
                  style={{ left: box.left, top: box.top, width: box.w, height: box.h, cursor: "grab", touchAction: "none", zIndex: 30 }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              )}
            </div>
            <p className="text-[11px] text-[#b5aca4] text-center mt-2">Live preview</p>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[70]">
          <button onClick={() => setToast(null)} className="bg-[#2d2926] text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg max-w-xs text-center">
            {toast}
          </button>
        </div>
      )}
    </>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-1">{label}</label>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]" />
    </div>
  );
}
