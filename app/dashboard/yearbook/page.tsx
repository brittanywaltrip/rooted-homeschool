import { redirect } from "next/navigation";

// Go straight to the reader so we don't chain two redirects
// (/dashboard/yearbook → /dashboard/memories/yearbook → …/read).
export default function YearbookRedirect() {
  redirect("/dashboard/memories/yearbook/read");
}
