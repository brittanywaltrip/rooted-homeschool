import { Font } from "@react-pdf/renderer";

/* Font registrations for React-PDF print sheets. Import this module as a
 * side-effect from any file that calls pdf(...) so the registration runs
 * before render. The fonts fetch from Google's CDN at PDF generation time;
 * first-time generation in a session pays one network round trip. */

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  Font.register({
    family: "Cormorant",
    fonts: [
      { src: "https://fonts.gstatic.com/s/cormorantgaramond/v16/co3YmX5slCNuHLi8bLeY9MK7whWMhyjornFLsS6V7w.woff2", fontWeight: 400 },
      { src: "https://fonts.gstatic.com/s/cormorantgaramond/v16/co3WmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2", fontWeight: 700 },
    ],
  });
  registered = true;
}
