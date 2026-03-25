"use client";

import Link from "next/link";

interface UpgradePromptProps {
  feature: string;
  valueProp: string;
  onDismiss?: () => void;
  inline?: boolean;
}

function daysUntilDeadline(): number {
  return Math.max(0, Math.ceil(
    (new Date("2026-04-30").getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
  ));
}

/** Inline banner variant */
function InlineBanner({ feature, valueProp, onDismiss }: UpgradePromptProps) {
  const days = daysUntilDeadline();
  return (
    <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#2d2926] mb-1">
            🔒 {feature}
          </p>
          <p className="text-xs text-[#5c7f63] leading-relaxed mb-3">
            {valueProp}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/upgrade"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-xs font-semibold transition-colors"
            >
              Claim Founding Price — $39/yr →
            </Link>
            {days > 0 && (
              <span className="text-[11px] text-[#7a6f65]">
                ⏳ {days} day{days !== 1 ? "s" : ""} left at this price
              </span>
            )}
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[#b5aca4] hover:text-[#7a6f65] text-lg leading-none shrink-0 transition-colors"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Full-screen modal variant */
function ModalPrompt({ feature, valueProp, onDismiss }: UpgradePromptProps) {
  const days = daysUntilDeadline();
  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onDismiss} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-[#fefcf9] rounded-3xl shadow-xl border border-[#e8e2d9] max-w-sm w-full p-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-4xl mb-4">🌿</div>
          <h2 className="text-lg font-bold text-[#2d2926] mb-2" style={{ fontFamily: "Georgia, serif" }}>
            Unlock {feature}
          </h2>
          <p className="text-sm text-[#5c7f63] leading-relaxed mb-5">
            {valueProp}
          </p>
          <Link
            href="/upgrade"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold text-sm transition-colors shadow-sm w-full justify-center"
          >
            Claim Founding Price — $39/yr →
          </Link>
          {days > 0 && (
            <p className="mt-3 text-xs text-[#7a6f65]">
              ⏳ {days} day{days !== 1 ? "s" : ""} left at this price
            </p>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="mt-4 text-xs text-[#b5aca4] hover:text-[#7a6f65] transition-colors"
            >
              Maybe later
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default function UpgradePrompt(props: UpgradePromptProps) {
  if (props.inline) return <InlineBanner {...props} />;
  return <ModalPrompt {...props} />;
}
