import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type CheckResult = {
  id: string;
  title: string;
  url: string;
  status: number | null;
  category: "broken" | "server_error" | "blocked" | "connection_failed";
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

async function checkUrl(url: string): Promise<{ status: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA },
    });
    clearTimeout(timeout);
    return { status: res.status };
  } catch {
    clearTimeout(timeout);
    return { status: null };
  }
}

function categorize(status: number | null): CheckResult["category"] {
  if (status === null) return "connection_failed";
  if (status === 404 || status === 410) return "broken";
  if (status === 403) return "blocked";
  if (status >= 500) return "server_error";
  return "broken"; // other 4xx
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
  ].filter((t) => !!t.url);

  if (targets.length === 0) {
    return NextResponse.json({ checked: 0, broken: 0 });
  }

  const results: CheckResult[] = [];

  // ── Check one row ─────────────────────────────────────────────────────────
  //
  // THE RULE THIS FUNCTION MUST KEEP: it writes last_check_status and
  // consecutive_failures, and NOTHING else. It must never set
  // verification_status or is_active on a listing, and a "blocked" result must
  // never hide anything.
  //
  // 403 here is mostly a false positive. Government and tourism sites, which
  // are most of the Mail Adventures catalog, routinely refuse automated
  // requests while working perfectly in a browser. Hiding a listing on that
  // signal would quietly delete working listings from a page families rely on.
  // Only a family report or Brittany flips a listing.
  async function checkOne(t: CheckTarget) {
    let { status } = await checkUrl(t.url);

    // Retry 403s once after a 2-second delay
    if (status === 403) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      ({ status } = await checkUrl(t.url));
    }

    const prevFailures = t.consecutive_failures;

    if (status !== null && status < 400) {
      // Link is healthy, reset tracking
      if (prevFailures > 0) {
        await supabase
          .from(t.source)
          .update({ last_check_status: "ok", consecutive_failures: 0 })
          .eq("id", t.id);
      }
      return;
    }

    const category = categorize(status);
    const newFailures = prevFailures + 1;

    await supabase
      .from(t.source)
      .update({
        last_check_status: category,
        consecutive_failures: newFailures,
      })
      .eq("id", t.id);

    results.push({
      id: t.id,
      title: t.title,
      url: t.url,
      status,
      category,
      consecutive_failures: newFailures,
      source: t.source,
    });
  }

  // ── Walk them a pool at a time ────────────────────────────────────────────
  // This used to be one unbounded Promise.all over 70 resources. Adding the
  // mailbox listings takes it to roughly 190 rows, each able to open a second
  // request on a 403 retry, and firing all of them at once from one serverless
  // invocation is how a link checker starts reporting connection failures it
  // caused itself. A pool of 10 keeps the whole sweep well inside the cron's
  // budget without that.
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

  // Group results
  const broken = results.filter((r) => r.category === "broken");
  const serverErrors = results.filter((r) => r.category === "server_error");
  const blocked = results.filter(
    (r) => r.category === "blocked" && r.consecutive_failures >= 3
  );
  const blockedMonitoring = results.filter(
    (r) => r.category === "blocked" && r.consecutive_failures < 3
  );
  const connectionFailed = results.filter(
    (r) => r.category === "connection_failed"
  );

  // Items that appear in the email
  const reportable = [...broken, ...serverErrors, ...blocked, ...connectionFailed];

  if (reportable.length > 0) {
    const renderSection = (
      title: string,
      items: CheckResult[],
      urgent: boolean
    ) => {
      if (items.length === 0) return "";
      const color = urgent ? "#c0392b" : "#7a6f65";
      return `
        <h3 style="color:${color}; margin-top:24px;">${title} (${items.length})</h3>
        <ul style="padding-left:20px;">
          ${items
            .map(
              (b) =>
                `<li style="margin-bottom:8px;">
                  <strong>${b.title}</strong> (${b.source === "mailbox_listings" ? "Mail Adventures" : "Resources"}), ${b.status ?? "timeout/DNS"}<br/>
                  <a href="${b.url}" style="color:#5c7f63;">${b.url}</a>
                </li>`
            )
            .join("")}
        </ul>
      `;
    };

    const summaryParts: string[] = [];
    if (broken.length + connectionFailed.length > 0)
      summaryParts.push(
        `${broken.length + connectionFailed.length} broken`
      );
    if (serverErrors.length > 0)
      summaryParts.push(`${serverErrors.length} server error${serverErrors.length > 1 ? "s" : ""}`);
    if (blocked.length > 0)
      summaryParts.push(`${blocked.length} blocked (persistent)`);
    if (blockedMonitoring.length > 0)
      summaryParts.push(`${blockedMonitoring.length} blocked (monitoring)`);

    const subject = `Weekly Link Check: ${summaryParts.join(", ")}`;

    await resend.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: "garfieldbrittany@gmail.com",
      subject,
      html: `
        <p style="font-family:sans-serif; color:#2d2926;">
          The weekly link check swept ${targets.length} link${targets.length > 1 ? "s" : ""} across Resources and Mail Adventures, and found issues with ${results.length}.<br/>
          <strong>${summaryParts.join(" · ")}</strong>
        </p>
        ${renderSection("🔴 Broken Links (404/410 — page removed)", broken, true)}
        ${renderSection("🔴 Connection Failed (timeout/DNS)", connectionFailed, true)}
        ${renderSection("🟡 Server Errors (500+ — site may be down temporarily)", serverErrors, false)}
        ${renderSection("🟠 Possibly Blocked (403 — persistent, 3+ weeks)", blocked, false)}
        ${blockedMonitoring.length > 0 ? `<p style="color:#7a6f65; font-size:13px; margin-top:16px;">ℹ️ ${blockedMonitoring.length} link${blockedMonitoring.length > 1 ? "s" : ""} returned 403 but ${blockedMonitoring.length > 1 ? "have" : "has"} failed fewer than 3 weeks — still monitoring.</p>` : ""}
        <p style="margin-top:24px;">Fix these in your <a href="https://rootedhomeschoolapp.com/admin" style="color:#5c7f63;">admin panel</a>.</p>
      `,
    });
  }

  return NextResponse.json({
    checked: targets.length,
    checked_resources: targets.filter((t) => t.source === "resources").length,
    checked_mailbox_listings: targets.filter((t) => t.source === "mailbox_listings").length,
    broken: broken.length,
    server_errors: serverErrors.length,
    blocked: blocked.length,
    blocked_monitoring: blockedMonitoring.length,
    connection_failed: connectionFailed.length,
  });
}
