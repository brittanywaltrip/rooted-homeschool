import { PARTNER_DISCLOSURE } from "@/lib/partner-disclosure";

/**
 * The Settings QR block a partner screenshots. The commission disclosure sits
 * inside the same bordered box as the QR code, so any screenshot of the box
 * carries it.
 */
export default function PartnerQrShareCard({ code }: { code: string }) {
  const referral = `https://rootedhomeschoolapp.com/?ref=${code}`;
  return (
    <div>
      <p className="text-xs font-semibold text-[#6366f1] uppercase tracking-widest mb-2">Your QR Code</p>
      <div className="flex justify-center">
        <figure
          data-testid="partner-qr-share-card"
          className="w-full max-w-[240px] bg-white border border-[#c7d2fe] rounded-2xl p-3 text-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/affiliate/qr?size=200&data=${encodeURIComponent(referral)}`}
            alt="Referral QR code"
            width={160}
            height={160}
            className="rounded-lg mx-auto"
          />
          <p className="mt-2 text-xs font-semibold tracking-wider text-[#2d5a3d] break-all">{code}</p>
          <figcaption className="mt-1 text-sm leading-snug text-[#2d2926]">{PARTNER_DISCLOSURE}</figcaption>
        </figure>
      </div>
      <p className="text-xs text-[#5c5049] text-center mt-2 leading-snug">
        Sharing a screenshot? Keep this whole box in the picture so the disclosure stays visible, and add it to your caption too.
      </p>
    </div>
  );
}
