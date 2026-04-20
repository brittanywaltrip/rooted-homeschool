"use client";

import { CheckCircle2, Circle } from "lucide-react";

type Props = {
  firstName: string | null;
  hasCurriculum: boolean;
  hasMemory: boolean;
  onAddCurriculum: () => void;
  onCaptureMemory: () => void;
};

export default function GettingStartedCard({
  firstName,
  hasCurriculum,
  hasMemory,
  onAddCurriculum,
  onCaptureMemory,
}: Props) {
  const stepsDone = 2 + (hasCurriculum ? 1 : 0) + (hasMemory ? 1 : 0);

  return (
    <div
      className="rounded-2xl p-6 sm:p-8 mb-6"
      style={{
        background: "linear-gradient(135deg, #F8F7F4 0%, #EFEDE7 100%)",
        border: "1px solid #e4e0d6",
      }}
    >
      <div className="mb-4">
        <div className="text-2xl sm:text-3xl mb-2"
             style={{ fontFamily: "var(--font-display), Georgia, serif", color: "#2D5A3D", fontWeight: 500 }}>
          🌿 Welcome to Rooted{firstName ? `, ${firstName}` : ""}
        </div>
        <p className="text-sm sm:text-base" style={{ color: "#4b5a4f", lineHeight: 1.55 }}>
          You've got the basics set up. Two more and you'll see how Rooted actually works —
        </p>
      </div>

      <ul className="space-y-3 my-5">
        <li className="flex items-center gap-3">
          <CheckCircle2 size={22} style={{ color: "#2D5A3D" }} />
          <span style={{ color: "#2D5A3D", fontSize: "15px" }}>Family created</span>
        </li>
        <li className="flex items-center gap-3">
          <CheckCircle2 size={22} style={{ color: "#2D5A3D" }} />
          <span style={{ color: "#2D5A3D", fontSize: "15px" }}>Kids added</span>
        </li>

        <li>
          <button
            type="button"
            onClick={onAddCurriculum}
            disabled={hasCurriculum}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors hover:bg-white disabled:cursor-default"
            style={{ border: hasCurriculum ? "1px solid transparent" : "1px solid #d4d0c4" }}
          >
            {hasCurriculum
              ? <CheckCircle2 size={22} style={{ color: "#2D5A3D" }} />
              : <Circle size={22} style={{ color: "#87927c" }} />}
            <span className="flex-1">
              <span style={{ color: hasCurriculum ? "#2D5A3D" : "#1a2c22", fontSize: "15px", fontWeight: 500 }}>
                Add your first curriculum
              </span>
              {!hasCurriculum && (
                <span className="block text-xs mt-0.5" style={{ color: "#87927c" }}>
                  takes about 2 minutes
                </span>
              )}
            </span>
            {!hasCurriculum && <span style={{ color: "#2D5A3D" }}>→</span>}
          </button>
        </li>

        <li>
          <button
            type="button"
            onClick={onCaptureMemory}
            disabled={hasMemory}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors hover:bg-white disabled:cursor-default"
            style={{ border: hasMemory ? "1px solid transparent" : "1px solid #d4d0c4" }}
          >
            {hasMemory
              ? <CheckCircle2 size={22} style={{ color: "#2D5A3D" }} />
              : <Circle size={22} style={{ color: "#87927c" }} />}
            <span className="flex-1">
              <span style={{ color: hasMemory ? "#2D5A3D" : "#1a2c22", fontSize: "15px", fontWeight: 500 }}>
                Capture your first memory
              </span>
              {!hasMemory && (
                <span className="block text-xs mt-0.5" style={{ color: "#87927c" }}>
                  a photo, a quote, a win — takes 10 seconds
                </span>
              )}
            </span>
            {!hasMemory && <span style={{ color: "#2D5A3D" }}>→</span>}
          </button>
        </li>
      </ul>

      <p className="text-xs mt-4" style={{ color: "#87927c", fontStyle: "italic" }}>
        {stepsDone}/4 done — take your time 🌱 Once both actions are done, everything else falls into place.
      </p>
    </div>
  );
}
