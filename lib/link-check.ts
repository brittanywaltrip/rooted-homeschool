// The weekly link checker's decisions, kept apart from the route so they can
// be tested without a network, a database or an email provider.
//
// What a result means, in the order a reader of the email cares about:
//   missing         404/410 on a real GET. The only category called broken.
//   unreachable     timeout, DNS or connection reset. Often temporary.
//   server_error    500+. The site is up but failing, often temporary.
//   blocked         403/429. Usually a site refusing bots, not a dead page.
//   login_required  401, or a redirect that lands on a sign-in page.
//   unexpected      any other 4xx that survives the GET fallback.
//   invalid_url     not an http(s) link, so no request is made at all.
//
// None of these hide or deactivate anything. The checker records a status and
// a failure count, and a person decides what to do with the email.

/** Where relative catalog paths such as /dashboard/printables/... live. The
 *  apex domain 308s here, so resolving against it directly saves a hop. */
export const ROOTED_ORIGIN = "https://www.rootedhomeschoolapp.com";

export const REQUEST_TIMEOUT_MS = 10_000;
export const BLOCKED_RETRY_DELAY_MS = 2_000;

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type LinkCategory =
  | "ok"
  | "login_required"
  | "missing"
  | "unreachable"
  | "server_error"
  | "blocked"
  | "unexpected"
  | "invalid_url";

/** Resolve a catalog URL to something fetchable, or null when it is not a web
 *  link. Relative paths resolve against the canonical Rooted origin, never
 *  against the cron request's own host. */
export function resolveLinkUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), ROOTED_ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.href;
}

const LOGIN_PATH =
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:login|log-in|signin|sign-in|sign_in|auth\/login|account\/login|accounts\/login|users\/sign_in|session\/new)(?:\/|$)/i;

/** True when a redirect landed on a sign-in page. */
export function isLoginUrl(finalUrl: string): boolean {
  try {
    return LOGIN_PATH.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}

export type Probe = {
  /** HTTP status of the last request made, or null when none completed. */
  status: number | null;
  /** URL the last request ended on after redirects. */
  finalUrl: string;
  redirected: boolean;
  /** Which method produced `status`. */
  method: "HEAD" | "GET";
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ProbeDeps = {
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

async function request(
  url: string,
  method: "HEAD" | "GET",
  deps: ProbeDeps
): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    // Only the status matters. Dropping the body keeps a GET bounded to the
    // response headers instead of downloading whole pages or PDFs.
    try {
      await res.body?.cancel();
    } catch {
      // A body that is already closed is fine.
    }
    return {
      status: res.status,
      finalUrl: res.url || url,
      redirected: res.redirected,
      method,
    };
  } catch {
    return { status: null, finalUrl: url, redirected: false, method };
  } finally {
    clearTimeout(timer);
  }
}

const worked = (p: Probe) => p.status !== null && p.status < 400;

/**
 * HEAD first because it is cheap. Anything short of success gets one GET,
 * since plenty of servers refuse or mishandle HEAD while serving the page to a
 * browser, and "missing" should only ever mean the page a family would load is
 * gone. A 403/429 on the GET gets one more try after a short pause.
 */
export async function probeLink(url: string, deps: ProbeDeps): Promise<Probe> {
  const head = await request(url, "HEAD", deps);
  if (worked(head)) return head;

  let get = await request(url, "GET", deps);
  if (get.status === 403 || get.status === 429) {
    await deps.sleep(BLOCKED_RETRY_DELAY_MS);
    get = await request(url, "GET", deps);
  }
  return get;
}

export function categorize(p: Probe): LinkCategory {
  if (p.status === null) return "unreachable";
  if (p.status === 401) return "login_required";
  if (p.redirected && isLoginUrl(p.finalUrl)) return "login_required";
  if (p.status < 400) return "ok";
  if (p.status === 404 || p.status === 410) return "missing";
  if (p.status === 403 || p.status === 429) return "blocked";
  if (p.status === 408) return "unreachable";
  if (p.status >= 500) return "server_error";
  return "unexpected";
}

/** Categories that count as a failure. A sign-in page works for the families
 *  it is meant for, so it resets the count like a healthy link does. */
export function isFailure(category: LinkCategory): boolean {
  return category !== "ok" && category !== "login_required";
}

/** Weeks of 403s before a blocked link is worth a look in the email. */
export const BLOCKED_PERSISTENT_WEEKS = 3;

export type ReportItem = {
  category: LinkCategory;
  consecutive_failures: number;
};

export type ReportCounts = {
  missing: number;
  invalid_url: number;
  unexpected: number;
  server_error: number;
  unreachable: number;
  blocked_persistent: number;
  blocked_monitoring: number;
  login_required: number;
};

export function countReport(items: ReportItem[]): ReportCounts {
  const n = (c: LinkCategory) => items.filter((i) => i.category === c).length;
  const blocked = items.filter((i) => i.category === "blocked");
  return {
    missing: n("missing"),
    invalid_url: n("invalid_url"),
    unexpected: n("unexpected"),
    server_error: n("server_error"),
    unreachable: n("unreachable"),
    blocked_persistent: blocked.filter((i) => i.consecutive_failures >= BLOCKED_PERSISTENT_WEEKS).length,
    blocked_monitoring: blocked.filter((i) => i.consecutive_failures < BLOCKED_PERSISTENT_WEEKS).length,
    login_required: n("login_required"),
  };
}

/** True when anything in the sweep deserves an email. Login-required pages
 *  and short-lived 403s are listed when an email goes out, but never send one
 *  on their own. */
export function shouldEmail(c: ReportCounts, trackingWriteFailures: number): boolean {
  return (
    c.missing + c.invalid_url + c.unexpected + c.server_error + c.unreachable + c.blocked_persistent > 0 ||
    trackingWriteFailures > 0
  );
}

/**
 * The subject keeps confirmed missing pages apart from everything that might
 * be temporary or a false alarm, so "3 missing" always means three pages a
 * family would hit a 404 on.
 */
export function reportSubject(c: ReportCounts, trackingWriteFailures: number): string {
  const parts: string[] = [];
  if (c.missing > 0) parts.push(`${c.missing} missing`);
  if (c.invalid_url > 0) parts.push(`${c.invalid_url} invalid URL${c.invalid_url > 1 ? "s" : ""}`);
  if (c.unexpected > 0) parts.push(`${c.unexpected} other error${c.unexpected > 1 ? "s" : ""}`);
  if (c.server_error > 0) parts.push(`${c.server_error} server error${c.server_error > 1 ? "s" : ""}`);
  if (c.unreachable > 0) parts.push(`${c.unreachable} couldn't connect`);
  if (c.blocked_persistent > 0) parts.push(`${c.blocked_persistent} blocked (persistent)`);
  if (trackingWriteFailures > 0) parts.push(`${trackingWriteFailures} not recorded`);
  const prefix = trackingWriteFailures > 0 ? "Weekly Link Check (incomplete)" : "Weekly Link Check";
  return parts.length > 0 ? `${prefix}: ${parts.join(", ")}` : `${prefix}: no issues`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
