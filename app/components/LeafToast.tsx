"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  count: number;
  onDone: () => void;
}

export default function LeafToast({ count, onDone }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(onDone, 1500);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{`
        /* translateX(-50%) is repeated in EVERY keyframe on purpose. This
           element sits left-1/2 and relies on a -50% shift to be centred,
           but animation-fill-mode: forwards makes the animated transform
           override the inline one for the element's whole life. Without the
           -50% here the toast rendered from the midpoint rightward and,
           being whiteSpace: nowrap, ran past the right edge on a phone.
           Any keyframe added below must carry it too. */
        @keyframes leafFloat {
          0%   { opacity: 1; transform: translateX(-50%) translateY(0) scale(0.8); }
          20%  { opacity: 1; transform: translateX(-50%) translateY(-10px) scale(1.1); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-60px) scale(1.0); }
        }
        @keyframes leafWobble {
          0%, 100% { transform: rotate(-5deg); }
          50%      { transform: rotate(5deg); }
        }
      `}</style>
      <div
        className="fixed top-20 left-1/2 z-[200] pointer-events-none"
        style={{
          transform: "translateX(-50%)",
          animation: "leafFloat 1.5s ease-out forwards",
        }}
      >
        <span
          className="text-lg font-bold"
          style={{ color: "#2D5A3D", fontSize: 18, whiteSpace: "nowrap" }}
        >
          +{count}{" "}
          <span
            style={{
              display: "inline-block",
              animation: "leafWobble 0.4s ease-in-out infinite",
            }}
          >
            🌿
          </span>
        </span>
      </div>
    </>,
    document.body,
  );
}
