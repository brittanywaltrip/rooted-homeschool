"use client";

import { useState, type CSSProperties } from "react";

/**
 * Aspect-aware photo on the soft #f5f0e8 mat — the same no-crop behavior as the
 * yearbook reader's MatPhoto, for surfaces that render an already-usable image
 * URL via a plain <img> (e.g. the year-end review + print pages). Tall /
 * full-length photos (natural w/h < 0.9) render object-contain so their tops
 * and bottoms are never cut; wide / square photos cover their cell. The fit is
 * read from the image's natural dimensions on load.
 *
 * Size the cell via `className` (Tailwind, e.g. "aspect-square") or `style`
 * (inline, e.g. { aspectRatio: "1 / 1" }) on the wrapper.
 */
export default function AspectPhoto({
  src,
  alt = "",
  onError,
  className = "",
  style,
  rounded = true,
}: {
  src: string;
  alt?: string;
  onError?: () => void;
  className?: string;
  style?: CSSProperties;
  rounded?: boolean;
}) {
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  return (
    <div
      className={`overflow-hidden bg-[#f5f0e8] ${rounded ? "rounded-lg" : ""} ${className}`}
      style={style}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setFit(img.naturalWidth / img.naturalHeight < 0.9 ? "contain" : "cover");
          }
        }}
        onError={onError}
        style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
      />
    </div>
  );
}
