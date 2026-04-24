import { redirect } from "next/navigation";

// The old landing page (marketing copy + stats + "Open Your Yearbook" CTA)
// was an unnecessary intermediate step — users clicking "Yearbook" expect
// to see their yearbook, not a preview of it. The reader view itself now
// owns the entry points for Edit, Download PDF, and the back link.
export default function YearbookIndexRedirect() {
  redirect("/dashboard/memories/yearbook/read");
}
