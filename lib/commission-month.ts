// commission_payments.month is stored as "YYYY-MM" (e.g. "2026-05").
// Settings page filters and renders against this value, so we centralize
// the format helpers here. Extracted from the page so the math is unit-
// testable without booting a JSX environment.
//
// Bug context: the original Settings page compared `p.month` against
// `new Date().toLocaleDateString("en-US", { month: "long", year:
// "numeric" })` which produces "May 2026", never matching the stored
// "2026-05" key. Every affiliate saw "Paid this month: $0.00" forever.

export function formatMonthKey(monthKey: string): string {
  // Accept only YYYY-MM with month 01-12. The month-rolling Date
  // constructor would otherwise turn "2026-13" into "January 2027",
  // hiding the upstream data error in user-visible UI.
  if (!monthKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return monthKey;
  const [yy, mm] = monthKey.split("-").map(Number);
  return new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function currentMonthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
