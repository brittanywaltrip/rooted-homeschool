"use client";

import Link from "next/link";

interface ExportGateModalProps {
  title: string;
  body: string;
  cta: string;
  onClose: () => void;
}

export default function ExportGateModal({ title, body, cta, onClose }: ExportGateModalProps) {
  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-[#fefcf9] rounded-3xl shadow-xl border border-[#e8e2d9] max-w-sm w-full p-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-4xl mb-4">🌿</div>
          <h2 className="text-lg font-bold text-[#2d2926] mb-2" style={{ fontFamily: "Georgia, serif" }}>
            {title}
          </h2>
          <p className="text-sm text-[#5c7f63] leading-relaxed mb-5">
            {body}
          </p>
          <Link
            href="/upgrade"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#C4962A] hover:bg-[#a67d1f] text-white font-semibold text-sm transition-colors shadow-sm w-full justify-center"
          >
            {cta}
          </Link>
          <button
            onClick={onClose}
            className="mt-4 text-xs text-[#b5aca4] hover:text-[#7a6f65] transition-colors block mx-auto"
          >
            Maybe later
          </button>
        </div>
      </div>
    </>
  );
}
