// The Free Printables catalog. One a month, made by us, with the PDFs living in
// public/printables. Adding next month stays a two step change with no logic to
// touch: drop the PDF in that folder and put a new entry at the top of this
// array.
//
// This lives in its own module because two places need the same answer: the
// Resources list that links to a printable, and the viewer route that has to
// resolve a slug back to a title and a file. Keeping one array means those two
// can never drift into disagreeing about what exists or where it lives.
//
// Deliberately dependency free. `npm test` runs node --test in strip-only mode,
// where a module-scope "@/" import cannot be resolved, so this file stays plain
// data and plain functions.

export type Printable = {
  /** URL segment for the viewer route, and the downloaded file's name. */
  slug: string;
  title: string;
  description: string;
  /** Path under public/, so it is served as a static asset. */
  file: string;
};

export const PRINTABLES: Printable[] = [
  {
    slug: "september-memory-challenge-2026",
    title: "September Memory Challenge",
    description: "One tiny moment a day, all month long.",
    file: "/printables/september-memory-challenge-2026.pdf",
  },
];

/** Resolve a viewer slug. Returns undefined for anything we do not publish. */
export function getPrintable(slug: string): Printable | undefined {
  return PRINTABLES.find((printable) => printable.slug === slug);
}
