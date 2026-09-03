import { Font } from "@react-pdf/renderer";

/* Font registration for the React-PDF print sheets. Import this module as a
 * side-effect from any file that calls pdf(...) so registration runs before
 * render.
 *
 * SELF-HOSTED, DELIBERATELY.
 *
 * This used to fetch two hardcoded fonts.gstatic.com URLs pinned to Cormorant
 * Garamond v16. Google rotated the family to v21 and both URLs started
 * returning 404, which took the whole Daily PDF export down for every family:
 * React-PDF's font fetch rejects, pdf() rejects, and the only thing the user
 * ever sees is "Couldn't generate the PDF, please try again" — with no version
 * of "again" that could have worked. The photo-failure retry in index.tsx does
 * not rescue it either, since the font is missing on both attempts.
 *
 * Two static weights now ship with the app. Generating a PDF makes no
 * third-party request, so nothing upstream can break it again. Worth knowing
 * if these ever need replacing: Google no longer publishes static weights for
 * this family. Its own CSS serves one VARIABLE file for both 400 and 700,
 * whose default instance is Light 300 — registering that would quietly render
 * the sheets lighter and leave bold headers un-bold. These two files are real
 * static instances (usWeightClass 400 and 700), which is what the sheet styles
 * expect.
 */

const CORMORANT_REGULAR = "/fonts/CormorantGaramond-Regular.woff2";
const CORMORANT_BOLD = "/fonts/CormorantGaramond-Bold.woff2";

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  // Set BEFORE the attempt. A throw here must not leave the flag false and
  // re-run a failing registration on every subsequent print.
  registered = true;
  try {
    Font.register({
      family: "Cormorant",
      fonts: [
        { src: CORMORANT_REGULAR, fontWeight: 400 },
        { src: CORMORANT_BOLD, fontWeight: 700 },
      ],
    });
  } catch (err) {
    // Same-origin assets shipped in the bundle, so reaching here means the
    // deploy itself is broken. Log rather than throw: the caller's own error
    // path is a better place to fail than module import.
    console.warn("[pdf-fonts] Cormorant registration failed", err);
  }
}
