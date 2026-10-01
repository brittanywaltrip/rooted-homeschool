"use client";

import { useState } from "react";
import { PARTNER_DISCLOSURE } from "@/lib/partner-disclosure";

export default function PartnerSharingGuide() {
  const [status, setStatus] = useState("");

  async function copyDisclosure() {
    try {
      await navigator.clipboard.writeText(PARTNER_DISCLOSURE);
      setStatus("Disclosure copied.");
    } catch {
      setStatus("Select and copy the disclosure text above.");
    }
  }

  return (
    <section className="rounded-xl border border-[#e8e2d9] bg-white p-4 text-sm text-[#2d2926]">
      <h3 className="font-semibold">Before you share</h3>
      <p className="mt-2">Tell people you may earn a commission whenever you recommend Rooted with your code or link. A code or “Rooted Partner” label alone doesn’t explain that.</p>
      <p className="mt-3 rounded-lg bg-[#f8f7f4] p-3 font-medium select-text">{PARTNER_DISCLOSURE}</p>
      <button type="button" onClick={copyDisclosure} className="mt-2 rounded-lg border border-[#e8e2d9] px-3 py-2 font-medium text-[#2d5a3d] hover:bg-[#f8f7f4]">
        Copy disclosure
      </button>
      <p role="status" className="mt-1 text-xs">{status}</p>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>Put the disclosure next to your recommendation and code or link, before any “more” button. Keep it readable on cards and QR screenshots.</li>
        <li>For Stories, put it on the image long enough to read. For video, say it and show it on screen; repeat it periodically during live streams.</li>
        <li>Describe only your own experience. Don’t promise results, guaranteed earnings, legal compliance, or privacy and security protections you haven’t verified.</li>
      </ul>
      <a href="https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block underline text-[#2d5a3d]">FTC disclosure guidance</a>
    </section>
  );
}
