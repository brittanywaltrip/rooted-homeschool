import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resendClient } from "@/lib/api-clients";
import {
  BLOCKED_PERSISTENT_WEEKS,
  categorize,
  countReport,
  escapeHtml,
  isFailure,
  probeLink,
  reportSubject,
  resolveLinkUrl,
  shouldEmail,
  type LinkCategory,
} from "@/lib/link-check";

type CheckResult = {
  id: string;
  title: string;
  url: string;
  /** The URL actually requested, after resolving a relative path. */
  checked_url: string | null;
  status: number | null;
  category: LinkCategory;
  consecutive_failures: number;
  /** Which table the row came from, so the email can say where to fix it. */
  source: "resources" | "mailbox_listings";
};

/** One row to check, flattened so both tables walk the same code path. */
type CheckTarget = {
  id: string;
  title: string;
  url: string;
  consecutive_failures: number;
  source: CheckResult["source"];
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(request: Request) {
  // An unset secret must not turn "Bearer undefined" into a valid header.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Gather both tables ────────────────────────────────────────────────────
  // public.resources and public.mailbox_listings are checked the same way and
  // flattened into one list first, so the walk, the retry and the write-back
  // logic exist once. mailbox_listings keeps its link in `official_url` rather
  // than `url`, which is the only difference between them here.
  const [resourcesRes, listingsRes] = await Promise.all([
    supabase.from("resources").select("id, title, url, consecutive_failures"),
    supabase
      .from("mailbox_listings")
      .select("id, title, official_url, consecutive_failures")
      .eq("is_active", true),
  ]);

  // A failed read is not an empty catalog. Carrying on would send a report
  // that looks clean while half the links were never checked.
  if (resourcesRes.error || listingsRes.error) {
    console.error("[cron/check-links] catalog read failed", {
      resources: resourcesRes.error?.message ?? null,
      mailbox_listings: listingsRes.error?.message ?? null,
    });
    return NextResponse.json({ error: "Link catalog read failed" }, { status: 500 });
  }

  const targets: CheckTarget[] = [
    ...(resourcesRes.data ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      url: r.url as string,
      consecutive_failures: (r.consecutive_failures as number) ?? 0,
      source: "resources" as const,
    })),
    ...(listingsRes.data ?? []).map((l) => ({
      id: l.id as string,
      title: l.title as string,
      url: l.official_url as string,
      consecutive_failures: (l.consecutive_failures as number) ?? 0,
      source: "mailbox_listings" as const,
    })),
  ].filter((t) => !!t.url && t.url.trim() !== "");

  if (targets.length === 0) {
    return NextResponse.json({ checked: 0, broken: 0 });
  }

  const results: CheckResult[] = [];
  const writeFailures: { id: string; source: CheckTarget["source"]; message: string }[] = [];

  // ── Check one row ─────────────────────────────────────────────────────────
  //
  // THE RULE THIS FUNCTION MUST KEEP: it writes last_check_status and
  // consecutive_failures, and NOTHING else. It must never set
  // verification_status or is_active on a listing, and no result of any kind
  // may hide anything.
  //
  // 403 here is mostly a false positive. Government and tourism sites, which
  // are most of the Mail Adventures catalog, routinely refuse automated
  // requests while working perfectly in a browser. Hiding a listing on that
  // signal would quietly delete working listings from a page families rely on.
  // Only a family report or Brittany flips a listing.
  async function checkOne(t: CheckTarget) {
    const checkedUrl = resolveLinkUrl(t.url);
    let status: number | null = null;
    let category: LinkCategory;
    if (checkedUrl === null) {
      category = "invalid_url";
    } else {
      const probe = await probeLink(checkedUrl, { fetch, sleep });
      status = probe.status;
      category = categorize(probe);
    }

    const prevFailures = t.consecutive_failures;
    const failed = isFailure(category);
    const newFailures = failed ? prevFailures + 1 : 0;

    // A healthy link that was already healthy needs no write.
    if (category !== "ok" || prevFailures > 0) {
      const { error } = await supabase
        .from(t.source)
        .update({
          last_check_status: category,
          consecutive_failures: newFailures,
        })
        .eq("id", t.id);
      if (error) {
        writeFailures.push({ id: t.id, source: t.source, message: error.message });
      }
    }

    if (category === "ok") return;

    results.push({
      id: t.id,
      title: t.title,
      url: t.url,
      checked_url: checkedUrl,
      status,
      category,
      consecutive_failures: newFailures,
      source: t.source,
    });
  }

  // ── Walk them a pool at a time ────────────────────────────────────────────
  // This used to be one unbounded Promise.all over 70 resources. Adding the
  // mailbox listings takes it to roughly 190 rows, each able to open a GET
  // fallback and a 403 retry, and firing all of them at once from one
  // serverless invocation is how a link checker starts reporting connection
  // failures it caused itself. A pool of 10 keeps the sweep well inside the
  // cron's budget without that.
  const POOL = 10;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(POOL, targets.length) }, async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++];
        await checkOne(t);
      }
    })
  );

  if (writeFailures.length > 0) {
    console.error("[cron/check-links] tracking writes failed", {
      count: writeFailures.length,
      first: writeFailures[0],
    });
  }

  const counts = countReport(results);
  const of = (c: LinkCategory) => results.filter((r) => r.category === c);
  const blocked = of("blocked");
  const blockedPersistent = blocked.filter((r) => r.consecutive_failures >= BLOCKED_PERSISTENT_WEEKS);

  let emailError: string | null = null;
  if (shouldEmail(counts, writeFailures.length)) {
    const renderSection = (title: string, note: string, items: CheckResult[], urgent: boolean) => {
      if (items.length === 0) return "";
      const color = urgent ? "#c0392b" : "#7a6f65";
      return `
        <h3 style="color:${color}; margin-top:24px; margin-bottom:4px;">${title} (${items.length})</h3>
        <p style="color:#7a6f65; font-size:13px; margin-top:0;">${note}</p>
        <ul style="padding-left:20px;">
          ${items
            .map(
              (b) =>
                `<li style="margin-bottom:8px;">
                  <strong>${escapeHtml(b.title)}</strong> (${b.source === "mailbox_listings" ? "Mail Adventures" : "Resources"}), ${b.status ?? "no response"}, ${b.consecutive_failures} week${b.consecutive_failures === 1 ? "" : "s"}<br/>
                  <a href="${escapeHtml(b.checked_url ?? b.url)}" style="color:#5c7f63;">${escapeHtml(b.url)}</a>
                </li>`
            )
            .join("")}
        </ul>
      `;
    };

    const subject = reportSubject(counts, writeFailures.length);

    const sent = await resendClient().emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: "garfieldbrittany@gmail.com",
      subject,
      html: `
        <p style="font-family:sans-serif; color:#2d2926;">
          The weekly link check swept ${targets.length} link${targets.length > 1 ? "s" : ""} across Resources and Mail Adventures. Only the first section is a confirmed missing page. Nothing has been hidden or turned off.
        </p>
        ${writeFailures.length > 0 ? `<p style="color:#c0392b;"><strong>This sweep is incomplete.</strong> ${writeFailures.length} result${writeFailures.length > 1 ? "s" : ""} could not be saved, so next week's failure counts for ${writeFailures.length > 1 ? "those links" : "that link"} will be off.</p>` : ""}
        ${renderSection("Missing pages", "404 or 410 on a full page load. These are gone.", of("missing"), true)}
        ${renderSection("Not a web link", "The saved URL is not an http or https address, so it was not checked.", of("invalid_url"), true)}
        ${renderSection("Other errors", "A 4xx other than 403, 404 or 410. Worth opening in a browser.", of("unexpected"), false)}
        ${renderSection("Server errors", "500 or above. The site may be down for a while.", of("server_error"), false)}
        ${renderSection("Couldn't connect", "Timeout, DNS or a dropped connection. Often temporary; check it if it keeps showing up.", of("unreachable"), false)}
        ${renderSection(`Blocked for ${BLOCKED_PERSISTENT_WEEKS}+ weeks`, "403 or 429. Usually a site refusing automated checks while working in a browser.", blockedPersistent, false)}
        ${renderSection("Needs sign-in", "The page asks for a login, so it can only be checked by someone signed in. Not counted as a failure.", of("login_required"), false)}
        ${counts.blocked_monitoring > 0 ? `<p style="color:#7a6f65; font-size:13px; margin-top:16px;">${counts.blocked_monitoring} more link${counts.blocked_monitoring > 1 ? "s" : ""} returned 403 or 429 for fewer than ${BLOCKED_PERSISTENT_WEEKS} weeks. Still watching.</p>` : ""}
        <p style="margin-top:24px;">Fix these in your <a href="https://rootedhomeschoolapp.com/admin" style="color:#5c7f63;">admin panel</a>.</p>
      `,
    });
    if (sent.error) {
      emailError = sent.error.message;
      console.error("[cron/check-links] report email failed", { message: emailError });
    }
  }

  const body = {
    checked: targets.length,
    checked_resources: targets.filter((t) => t.source === "resources").length,
    checked_mailbox_listings: targets.filter((t) => t.source === "mailbox_listings").length,
    // "broken" means confirmed missing pages only.
    broken: counts.missing,
    missing: counts.missing,
    invalid_url: counts.invalid_url,
    unexpected: counts.unexpected,
    server_errors: counts.server_error,
    unreachable: counts.unreachable,
    blocked: counts.blocked_persistent,
    blocked_monitoring: counts.blocked_monitoring,
    login_required: counts.login_required,
    tracking_write_failures: writeFailures.length,
    email_error: emailError,
  };

  // A sweep whose results were not all saved, or whose report never left, did
  // not succeed, and the cron log should say so.
  const complete = writeFailures.length === 0 && emailError === null;
  return NextResponse.json(body, { status: complete ? 200 : 500 });
}
