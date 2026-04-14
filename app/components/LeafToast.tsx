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
        @keyframes leafFloat {
          0%   { opacity: 1; transform: translateY(0) scale(0.8); }
          20%  { opacity: 1; transform: translateY(-10px) scale(1.1); }
          100% { opacity: 0; transform: translateY(-60px) scale(1.0); }
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
