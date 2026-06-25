// Backfill memories.photo_width / photo_height for rows that have a photo but
// no stored dimensions. The yearbook uses each photo's shape to lay it out
// without cropping tall photos, so older photos need their dimensions filled in.
//
// Run: npm run backfill:photo-dimensions
//
// Reads each photo via a short-lived signed URL, measures it with sharp, and
// writes width/height. Processes the whole backlog in one pass, logs progress,
// and skips any row that fails to load instead of crashing.

import sharp from "sharp";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const BUCKET = "memory-photos";
const PAGE = 1000;
const LOG_EVERY = 100;

type Row = { id: string; photo_url: string | null };

// Minimal path extractor (mirrors lib/photo-url.ts) — kept inline so this node
// script doesn't import the `@/`-aliased module, which node can't resolve.
function extractPath(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  const input = urlOrPath.trim();
  if (!input) return null;
  const markers = [
    `/storage/v1/object/public/${BUCKET}/`,
    `/storage/v1/object/sign/${BUCKET}/`,
    `/storage/v1/object/${BUCKET}/`,
    `/object/public/${BUCKET}/`,
    `/object/sign/${BUCKET}/`,
    `/object/${BUCKET}/`,
  ];
  for (const marker of markers) {
    const idx = input.indexOf(marker);
    if (idx !== -1) {
      const rest = input.slice(idx + marker.length);
      const q = rest.indexOf("?");
      return q === -1 ? rest : rest.slice(0, q);
    }
  }
  // External URL (has protocol/host) → not in our bucket; otherwise a bare path.
  if (input.includes("://") || input.startsWith("//")) return null;
  const q = input.indexOf("?");
  return q === -1 ? input : input.slice(0, q);
}

async function main() {
  const admin = getSupabaseAdmin();

  // Phase 1 — collect every candidate row up front (read-only paginate, so
  // in-flight updates can't shift the window mid-run).
  const candidates: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("memories")
      .select("id, photo_url")
      .not("photo_url", "is", null)
      .or("photo_width.is.null,photo_height.is.null")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[backfill] candidate query failed:", error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as Row[];
    candidates.push(...rows);
    if (rows.length < PAGE) break;
  }

  console.log(`[backfill] ${candidates.length} memory rows need dimensions`);
  if (candidates.length === 0) return;

  // Phase 2 — measure + update, skipping failures.
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    try {
      const path = extractPath(row.photo_url);
      if (!path) { skipped++; console.warn(`[backfill] ${row.id}: unparseable photo_url — skipped`); }
      else {
        const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
        if (signErr || !signed?.signedUrl) { skipped++; console.warn(`[backfill] ${row.id}: sign failed (${signErr?.message ?? "no url"}) — skipped`); }
        else {
          const res = await fetch(signed.signedUrl);
          if (!res.ok) { skipped++; console.warn(`[backfill] ${row.id}: fetch ${res.status} — skipped`); }
          else {
            const buf = Buffer.from(await res.arrayBuffer());
            const meta = await sharp(buf).metadata();
            if (!meta.width || !meta.height) { skipped++; console.warn(`[backfill] ${row.id}: no dimensions from sharp — skipped`); }
            else {
              const { error: upErr } = await admin
                .from("memories")
                .update({ photo_width: meta.width, photo_height: meta.height })
                .eq("id", row.id);
              if (upErr) { skipped++; console.warn(`[backfill] ${row.id}: update failed (${upErr.message}) — skipped`); }
              else updated++;
            }
          }
        }
      }
    } catch (e) {
      skipped++;
      console.warn(`[backfill] ${row.id}: ${e instanceof Error ? e.message : String(e)} — skipped`);
    }

    if ((i + 1) % LOG_EVERY === 0 || i === candidates.length - 1) {
      console.log(`[backfill] ${i + 1}/${candidates.length} processed · updated=${updated} skipped=${skipped}`);
    }
  }

  console.log(`[backfill] done — updated=${updated}, skipped=${skipped}, total=${candidates.length}`);
}

main().catch((e) => { console.error("[backfill] fatal:", e); process.exit(1); });
