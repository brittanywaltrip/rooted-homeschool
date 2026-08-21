"use client";

// Printable viewer.
//
// WHY THIS ROUTE EXISTS. The Resources card used to link straight at the PDF
// with a download attribute. On desktop that downloads and the page never
// moves. Inside the iOS Capacitor shell there is no browser chrome, so the same
// link navigated the WebView onto the PDF with no back button, no share button,
// and no way out except force quitting the app. Reproduced on a real phone.
//
// So the card now lands here instead: our own page, with our own header, which
// means a guaranteed way back. The PDF is embedded below that header rather
// than navigated to, and saving happens through the native share sheet on
// phones so the file reaches Files, AirDrop, or Print the way an app user
// expects.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Share } from "lucide-react";

import { getPrintable, type Printable } from "@/lib/printables";
import { posthog } from "@/lib/posthog";

// Web Share is still uneven across TypeScript's DOM lib versions, and the files
// member in particular. Declaring the two methods we use keeps this honest
// without an `any` and without depending on which lib.dom shipped.
type ShareCapableNavigator = Navigator & {
  canShare?: (data?: { files?: File[]; title?: string }) => boolean;
  share?: (data?: { files?: File[]; title?: string }) => Promise<void>;
};

/**
 * Plain download, the desktop path and the fallback for anything that cannot
 * share files. Same programmatic anchor click the card used to do inline.
 */
function downloadDirect(printable: Printable): void {
  const anchor = document.createElement("a");
  anchor.href = printable.file;
  anchor.download = `${printable.slug}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function PrintableViewerPage() {
  const params = useParams();
  const raw = params?.slug;
  const slug = Array.isArray(raw) ? raw[0] : (raw ?? "");
  const printable = getPrintable(slug);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!printable) return;
    document.title = `${printable.title} · Rooted`;
    posthog.capture("printable_viewed", { printable: printable.slug });
  }, [printable]);

  // Unknown slug. A family can land here from a stale link or a typo, so this
  // is a soft landing with the way back, not a dead end.
  if (!printable) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-base font-semibold text-[#2d2926] mb-2">
          We could not find that printable
        </p>
        <p className="text-sm text-[#7a6f65] mb-6 leading-relaxed">
          It may have been renamed or retired. Everything we have is on the
          Resources page.
        </p>
        <Link
          href="/dashboard/resources"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--g-brand)] hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Resources
        </Link>
      </div>
    );
  }

  async function handleSaveOrShare() {
    if (!printable || busy) return;
    setBusy(true);
    setError(null);
    posthog.capture("printable_downloaded", { printable: printable.slug });

    try {
      // Ask before paying for the download. canShare only inspects the file's
      // name and type, so an empty File is a truthful probe and costs nothing.
      const nav = navigator as ShareCapableNavigator;
      const probe = new File([], `${printable.slug}.pdf`, { type: "application/pdf" });
      const canShareFile =
        typeof nav.canShare === "function" &&
        typeof nav.share === "function" &&
        nav.canShare({ files: [probe] });

      if (canShareFile) {
        const res = await fetch(printable.file);
        if (!res.ok) throw new Error(`Could not fetch printable: ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], `${printable.slug}.pdf`, { type: "application/pdf" });
        await nav.share!({ files: [file], title: printable.title });
        return;
      }

      downloadDirect(printable);
    } catch (err) {
      // Dismissing the share sheet throws AbortError. That is a family choosing
      // not to save, which is a normal thing to do, so it stays silent.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Anything else: still try to hand over the file rather than stopping at
      // an error message.
      try {
        downloadDirect(printable);
      } catch {
        setError("We could not open that file. Please try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "#faf9f6" }}>
      {/* Sticky so the way out is reachable no matter how far down the PDF a
          family has scrolled. That is the whole point of this page. */}
      <div className="sticky top-0 z-10 border-b border-[#e8e5e0] bg-[#faf9f6]/95 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Link
            href="/dashboard/resources"
            className="inline-flex items-center gap-1.5 text-xs text-[#7a6f65] hover:text-[var(--g-deep)] transition-colors"
          >
            <ArrowLeft size={13} />
            Back to Resources
          </Link>
          <div className="mt-2 flex items-center justify-between gap-4">
            <h1 className="text-base font-bold text-[#2d2926] leading-snug min-w-0">
              {printable.title}
            </h1>
            <button
              type="button"
              onClick={handleSaveOrShare}
              disabled={busy}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[var(--g-brand)] hover:bg-[var(--g-mid)] disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Share size={13} />
              {busy ? "Working..." : "Save or Share"}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-[#7a2020]">{error}</p>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        <object
          data={printable.file}
          type="application/pdf"
          className="w-full h-[75vh] rounded-2xl border border-[#e8e5e0] bg-white"
          aria-label={printable.title}
        >
          {/* Shown only when the browser refuses to embed the PDF at all. */}
          <p className="p-6 text-sm text-[#7a6f65] leading-relaxed">
            Your browser cannot preview this file.{" "}
            <a
              href={printable.file}
              download={`${printable.slug}.pdf`}
              className="font-semibold text-[var(--g-brand)] hover:underline"
            >
              Download it instead
            </a>
            .
          </p>
        </object>
      </div>
    </div>
  );
}
