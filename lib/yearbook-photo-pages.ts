// ─── Yearbook photo paging ───────────────────────────────────────────────────
// Pure TypeScript (no React) so it's unit-testable. Turns a chapter's photos
// into a sequence of "photo pages" for the reader:
//
//   - Wide / square photos (w/h >= 0.9, or dimensions unknown) tile into collage
//     pages of up to 6 (rendered 4 -> 2x2, 5-6 -> 2x3, 3 -> 1-big-2, 2 -> pair,
//     1 -> hero).
//   - Tall / full-length photos (w/h < 0.9) are lifted out of the grid so they
//     are never crammed into a small cell: consecutive talls pair up
//     (side-by-side), a lone tall gets its own hero page.
//
// Chronological order is preserved as much as possible: photos stream in order,
// the wide buffer flushes whenever a tall photo interrupts it.

export interface PhotoPageItem {
  id: string;
  photo_url: string | null;
  photo_width?: number | null;
  photo_height?: number | null;
}

export type PhotoPageKind = "hero" | "pair" | "grid";

export interface PhotoPage {
  kind: PhotoPageKind;
  photos: PhotoPageItem[];
}

/** Tall only when both dimensions are present and width/height < 0.9. Unknown
 *  dimensions are treated as wide (so the photo tiles; the renderer's load-time
 *  contain-fit is the safety net that still prevents any crop). */
export function isTallPhoto(p: PhotoPageItem): boolean {
  return (
    typeof p.photo_width === "number" &&
    typeof p.photo_height === "number" &&
    p.photo_height > 0 &&
    p.photo_width / p.photo_height < 0.9
  );
}

const MAX_PER_GRID = 6;

function wideChunkKind(n: number): PhotoPageKind {
  if (n === 1) return "hero";
  if (n === 2) return "pair";
  return "grid"; // 3-6
}

export function buildPhotoPages(photos: PhotoPageItem[]): PhotoPage[] {
  const pages: PhotoPage[] = [];
  let wide: PhotoPageItem[] = [];

  const flushWide = () => {
    while (wide.length > 0) {
      const chunk = wide.slice(0, MAX_PER_GRID);
      wide = wide.slice(MAX_PER_GRID);
      pages.push({ kind: wideChunkKind(chunk.length), photos: chunk });
    }
  };

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (isTallPhoto(p)) {
      // A tall photo interrupts the wide run — flush it first so order holds.
      flushWide();
      const next = photos[i + 1];
      if (next && isTallPhoto(next)) {
        pages.push({ kind: "pair", photos: [p, next] });
        i++; // consumed the pair
      } else {
        pages.push({ kind: "hero", photos: [p] });
      }
    } else {
      wide.push(p);
    }
  }
  flushWide();

  return pages;
}
