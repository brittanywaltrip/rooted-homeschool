"use client";

import { useEffect, useState, ImgHTMLAttributes, CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { extractPath, signedPhotoUrl } from "@/lib/photo-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  bucket: string;
  expiresInSeconds?: number;
  className?: string;
  style?: CSSProperties;
};

export default function SignedImage({
  src,
  bucket,
  expiresInSeconds = 3600,
  className = "",
  style,
  alt = "",
  ...rest
}: Props) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResolved(null);

    if (!src) {
      if (!cancelled) setLoading(false);
      return;
    }

    const path = extractPath(src, bucket);
    if (path === null) {
      // External URL (e.g. Google avatar) — use directly.
      if (!cancelled) {
        setResolved(src);
        setLoading(false);
      }
      return;
    }

    signedPhotoUrl(supabase, bucket, src, expiresInSeconds).then((url) => {
      if (cancelled) return;
      setResolved(url);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [src, bucket, expiresInSeconds]);

  if (loading || !resolved) {
    return <div className={`bg-[#e8e2d9] ${className}`} style={style} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved} alt={alt} className={className} style={style} {...rest} />;
}
