import Link from "next/link";

interface PaywallCardProps {
  feature: string;       // e.g. "Compliance Reports"
  description: string;   // one-line pitch
}

export default function PaywallCard({ feature, description }: PaywallCardProps) {
  return (
    <div className="max-w-md mx-auto mt-12 px-5">
      <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-3xl p-8 text-center shadow-sm">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-xl font-bold text-[#2d2926] mb-2" style={{ fontFamily: "Georgia, serif" }}>
          Unlock {feature}
        </h2>
        <p className="text-sm text-[#5c7f63] leading-relaxed mb-6">
          {description}
        </p>
        <Link
          href="/dashboard/pricing"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold text-sm transition-colors shadow-sm"
        >
          ✨ Upgrade to Pro
        </Link>
        <p className="mt-4 text-xs text-[#7a9e7e]">
          Founding Family plan · $39/yr locked forever
        </p>
      </div>
    </div>
  );
}
