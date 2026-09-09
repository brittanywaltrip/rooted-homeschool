"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, Mailbox, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { posthog } from "@/lib/posthog";
import PageHero from "@/app/components/PageHero";
import ResourceReportSheet, { type ReportTarget } from "@/components/ResourceReportSheet";
import {
  CATEGORY_LABELS,
  availableCategories,
  availableStates,
  filterListings,
  listingChips,
  memoryTitleFor,
  nextProgress,
  verifiedFooter,
  type FilterId,
  type MailListing,
  type MailProgress,
} from "@/lib/mail-adventures";

/**
 * Mail Adventures.
 *
 * A plain, free list of real things a child can request by mail, open to every
 * family on every plan. There is no paywall and no game layer here: no progress
 * bar, no completion count, no streak, no badge earned for asking. Requested and
 * Received are utility marks so a parent who sent fifteen envelopes can see
 * which fifteen, and nothing more.
 *
 * PRIVACY RULE (carried from the migration, do not remove): this page never
 * stores, asks for, or autofills a mailing address, a street, a city or a ZIP.
 * The family types their address into the organization's own form, on the
 * organization's own site. Rooted keeps the list, never the address.
 */

const FLAG_CHIPS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "rooted_picks", label: "Rooted Picks" },
  { id: "hidden_gems", label: "Hidden Gems" },
  { id: "earn_it", label: "Earn It" },
];

const LISTING_COLUMNS =
  "id, slug, title, organization, category, state_region, delivery_type, reward_type, is_earn_it, " +
  "what_you_get, how_to_get_it, age_grade, delivery_time, supply_caveat, is_rooted_pick, is_hidden_gem, " +
  "last_verified, verification_status, official_url, url_quality, is_active, sort_order";

function isFilterId(value: string): value is FilterId {
  return (
    value === "all" ||
    value === "rooted_picks" ||
    value === "hidden_gems" ||
    value === "earn_it" ||
    Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value)
  );
}

export default function MailAdventuresPage() {
  const [listings, setListings] = useState<MailListing[]>([]);
  const [progress, setProgress] = useState<Record<string, MailProgress>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterId>("all");
  const [state, setState] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [report, setReport] = useState<{ target: ReportTarget; reason?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  useEffect(() => {
    document.title = "Mail Adventures · Rooted";
    posthog.capture("mail_adventures_viewed");
  }, []);

  // ── Read the filter state out of the URL on first paint ───────────────────
  // Shared and bookmarked links land on the view they name. Read once: after
  // this the URL follows the chips, not the other way round.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const f = params.get("filter");
    if (f && isFilterId(f)) setFilter(f);
    const s = params.get("state");
    if (s) setState(s);
    const q = params.get("q");
    if (q) setQuery(q);
  }, []);

  // ── Keep the URL in sync so a filtered view can be shared or returned to ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (filter === "50_states" && state) params.set("state", state);
    if (query.trim()) params.set("q", query.trim());
    const search = params.toString();
    window.history.replaceState({}, "", search ? `${window.location.pathname}?${search}` : window.location.pathname);
  }, [filter, state, query]);

  // ── Load listings and this family's marks together ────────────────────────
  // One trip for both, so the cards paint with their checkmarks already on.
  // Loading the marks separately made every card flash unmarked first, which
  // reads as "Rooted lost my list" to a parent who marked twenty of them.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);

      const listingsQuery = supabase
        .from("mailbox_listings")
        .select(LISTING_COLUMNS)
        .eq("is_active", true)
        .in("verification_status", ["verified", "needs_recheck"]);

      const [listingsRes, progressRes] = await Promise.all([
        listingsQuery,
        user
          ? supabase
              .from("mailbox_progress")
              .select("listing_id, requested_at, received_at")
              .eq("user_id", user.id)
              .is("child_id", null)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (listingsRes.error) throw listingsRes.error;
      setListings((listingsRes.data ?? []) as unknown as MailListing[]);

      const marks: Record<string, MailProgress> = {};
      for (const row of (progressRes.data ?? []) as MailProgress[]) {
        marks[row.listing_id] = row;
      }
      setProgress(marks);
    } catch {
      setToast("Couldn't load the list just now. Pull to refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const categories = useMemo(() => availableCategories(listings), [listings]);
  const states = useMemo(() => availableStates(listings), [listings]);
  const visible = useMemo(
    () => filterListings({ listings, filter, state, query }),
    [listings, filter, state, query]
  );

  // Once a family has marked anything Requested they know how this works, so
  // the three-step row collapses to a single line and gives the space back to
  // the listings.
  const hasMarkedAnything = useMemo(
    () => Object.values(progress).some((p) => p.requested_at || p.received_at),
    [progress]
  );

  // ── The toggles ───────────────────────────────────────────────────────────
  // Optimistic, reverted on error.
  //
  // NOT an upsert, though it reads like one. PostgREST's `on_conflict` takes a
  // bare column list, and Postgres cannot infer a PARTIAL unique index from
  // one: matching mailbox_progress_family_listing_uniq needs the statement to
  // repeat the index predicate (WHERE child_id IS NULL), which PostgREST has no
  // way to send. Upserting on (user_id, listing_id) returns 42P10, "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification", and
  // every tap silently 400s. Verified against staging.
  //
  // So the write is explicit: UPDATE when we already hold the family's row,
  // INSERT when we do not, and fall back to UPDATE on a 23505 in case another
  // tab created it in between. The partial index still earns its place, as the
  // guard that makes that duplicate impossible rather than as a conflict target.
  async function writeProgress(
    listingId: string,
    next: { requested_at: string | null; received_at: string | null },
    now: string,
    existing: MailProgress | undefined
  ) {
    const patch = { ...next, updated_at: now };

    if (existing) {
      const { error } = await supabase
        .from("mailbox_progress")
        .update(patch)
        .eq("user_id", userId as string)
        .eq("listing_id", listingId)
        .is("child_id", null);
      return error;
    }

    const { error: insErr } = await supabase
      .from("mailbox_progress")
      .insert({ user_id: userId as string, child_id: null, listing_id: listingId, ...patch });

    if (insErr && insErr.code === "23505") {
      const { error } = await supabase
        .from("mailbox_progress")
        .update(patch)
        .eq("user_id", userId as string)
        .eq("listing_id", listingId)
        .is("child_id", null);
      return error;
    }
    return insErr;
  }

  async function toggle(listing: MailListing, mark: "requested" | "received") {
    if (!userId) { setToast("You're not signed in."); return; }

    const before = progress[listing.id];
    const now = new Date().toISOString();
    const next = nextProgress(before, mark, now);
    const optimistic: MailProgress = { listing_id: listing.id, ...next };

    setProgress((prev) => ({ ...prev, [listing.id]: optimistic }));
    posthog.capture("mail_listing_marked", {
      slug: listing.slug,
      mark,
      on: mark === "requested" ? !!next.requested_at : !!next.received_at,
    });

    const error = await writeProgress(listing.id, next, now, before);

    if (error) {
      setProgress((prev) => {
        const revert = { ...prev };
        if (before) revert[listing.id] = before;
        else delete revert[listing.id];
        return revert;
      });
      setToast("That didn't save. Try again.");
    }
  }

  const showFullHowItWorks = !hasMarkedAnything || howItWorksOpen;

  return (
    <>
      <PageHero
        overline="Discover"
        title="Mail Adventures 📬"
        subtitle="Real things your kids can request by mail. Rooted keeps your list; your address goes straight to the organization."
      />

      <div className="max-w-3xl px-4 pt-5 pb-10 space-y-5" style={{ background: "#faf9f6" }}>
        <Link
          href="/dashboard/resources"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5c7f63] hover:text-[#4a6650] transition-colors"
        >
          <ArrowLeft size={14} />
          Resources
        </Link>

        {/* ── How it works ──────────────────────────────────────────────── */}
        {showFullHowItWorks ? (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74]">How it works</p>
              {hasMarkedAnything && (
                <button onClick={() => setHowItWorksOpen(false)} aria-label="Hide how it works" className="text-[#b5aca4] hover:text-[#7a6f65]">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { emoji: "🔎", label: "Pick one", sub: "Browse by category or state" },
                { emoji: "✉️", label: "Request it", sub: "On the organization's own site. Your address goes to them, never through Rooted" },
                { emoji: "📬", label: "Watch the mailbox", sub: "Mark it Received and add a memory when it arrives" },
              ].map((step) => (
                <div key={step.label} className="text-center">
                  <div className="text-2xl mb-1">{step.emoji}</div>
                  <p className="text-[12px] font-bold text-[#2D2A26] leading-tight mb-1">{step.label}</p>
                  <p className="text-[11px] text-[#8B7E74] leading-snug">{step.sub}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setHowItWorksOpen(true)}
            className="w-full text-left bg-white border border-[#e8e5e0] rounded-2xl px-4 py-3 text-xs font-semibold text-[#5c7f63] hover:bg-[#faf9f7] transition-colors"
          >
            How it works
          </button>
        )}

        {/* ── Search ────────────────────────────────────────────────────── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#b5aca4] pointer-events-none" />
          <input
            type="search"
            name="listing-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search maps, guides, activity books"
            aria-label="Search listings"
            className="w-full rounded-2xl border border-[#e8e2d9] bg-white pl-9 pr-9 py-2.5 text-sm text-[#2d2926] placeholder:text-[#b5aca4] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/30"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#b5aca4] hover:text-[#7a6f65]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Chips ─────────────────────────────────────────────────────── */}
        {/* Single select. Categories come from the data, so a category with no
            listings yet has no dead chip, and the first listing added to one
            brings its chip along with no code change. */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {[...FLAG_CHIPS, ...categories.map((c) => ({ id: c as FilterId, label: CATEGORY_LABELS[c] }))].map((chip) => {
            const active = filter === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => { setFilter(chip.id); if (chip.id !== "50_states") setState(null); }}
                aria-pressed={active}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                  active
                    ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                    : "bg-white text-[#5C5346] border-[#e8e5e0] hover:border-[#5c7f63]"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* ── State picker, only under 50 States ────────────────────────── */}
        {filter === "50_states" && states.length > 0 && (
          <div>
            <label htmlFor="state-picker" className="block text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-1.5">
              State
            </label>
            <select
              id="state-picker"
              value={state ?? ""}
              onChange={(e) => setState(e.target.value || null)}
              className="w-full rounded-2xl border border-[#e8e2d9] bg-white px-3 py-2.5 text-sm text-[#2d2926] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/30"
            >
              <option value="">Every state we have</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── The list ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-[#e8e5e0] rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-[#f0ece5] rounded w-2/3 mb-2" />
                <div className="h-3 bg-[#f0ece5] rounded w-1/3 mb-3" />
                <div className="h-3 bg-[#f0ece5] rounded w-full" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl p-6 text-center">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm font-bold text-[#2D2A26] mb-1">Nothing under that filter yet.</p>
            <p className="text-xs text-[#8B7E74] leading-relaxed mb-4">
              Try All, or tell me what you were looking for.
            </p>
            <button
              onClick={() => { setFilter("all"); setState(null); setQuery(""); }}
              className="px-4 py-2 rounded-2xl bg-[#5c7f63] hover:bg-[#4a6650] text-white font-semibold text-xs transition-colors"
            >
              Show all listings
            </button>
            {/* The plan also wanted a "tell me what you were looking for" report
                from here, with "Something else" preselected. It is deliberately
                not wired up: resource_reports carries a check constraint that
                every row name exactly one real resource_id or
                mailbox_listing_id, and there is no listing to name when the
                filter matched nothing. Pointing the row at an arbitrary listing
                would put a made-up target on the founder desk, which is worse
                than not collecting it. A nullable-target report row is the fix,
                and it is a schema change rather than a page change. */}
          </div>
        ) : (
          <>
            <p className="text-[11px] text-[#8B7E74] pl-1">
              {visible.length} {visible.length === 1 ? "listing" : "listings"}
            </p>
            <div className="space-y-3">
              {visible.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  progress={progress[l.id]}
                  onToggle={toggle}
                  onReport={() => setReport({ target: { kind: "mailbox", listingId: l.id, title: l.title } })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {report && (
        <ResourceReportSheet
          target={report.target}
          initialReason={report.reason}
          onClose={() => setReport(null)}
          onSent={(m) => setToast(m)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl bg-[#2d2926] text-white text-sm shadow-lg max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </>
  );
}

// ─── One listing ─────────────────────────────────────────────────────────────

function ListingCard({
  listing,
  progress,
  onToggle,
  onReport,
}: {
  listing: MailListing;
  progress: MailProgress | undefined;
  onToggle: (l: MailListing, mark: "requested" | "received") => void;
  onReport: () => void;
}) {
  const requested = !!progress?.requested_at;
  const received = !!progress?.received_at;
  const memoryTitle = memoryTitleFor(listing);

  return (
    <div className="bg-white border border-[#e8e5e0] rounded-2xl p-4">
      <h3 className="text-base font-bold text-[#2D2A26] leading-snug">{listing.title}</h3>
      <p className="text-xs text-[#8B7E74] mt-0.5 mb-2">{listing.organization}</p>
      <p className="text-sm text-[#5C5346] leading-relaxed mb-2.5">{listing.what_you_get}</p>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {listingChips(listing).map((chip) => (
          <span key={chip} className="px-2 py-0.5 rounded-full bg-[#f5f2ec] text-[11px] font-medium text-[#5C5346]">
            {chip}
          </span>
        ))}
      </div>

      {listing.how_to_get_it && (
        <p className="text-xs text-[#5C5346] leading-relaxed mb-1.5">{listing.how_to_get_it}</p>
      )}
      {listing.supply_caveat && (
        <p className="text-[11px] text-[#b5aca4] italic mb-1.5">{listing.supply_caveat}</p>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────
          Every listing shows when it was last checked, including the ones
          being re-verified. The link checker's "blocked" status is never
          surfaced here: government and tourism sites refuse bots and work
          fine in a browser, so showing it would scare a family off a
          working link. */}
      <p className="text-[11px] text-[#8B7E74] mt-3 mb-2">{verifiedFooter(listing)}</p>

      <a
        href={listing.official_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => posthog.capture("mail_listing_opened", { slug: listing.slug, category: listing.category })}
        className="inline-flex items-center justify-center gap-1.5 w-full py-2.5 rounded-2xl bg-[#5c7f63] hover:bg-[#4a6650] text-white font-semibold text-sm transition-colors"
      >
        Open official page
        <ExternalLink size={14} />
      </a>
      {listing.url_quality === "general_page" && (
        <p className="text-[11px] text-[#8B7E74] mt-1.5 leading-snug">
          This opens the organization&apos;s page; look for the request or order form.
        </p>
      )}

      {/* ── Requested / Received ──────────────────────────────────────────
          Plain utility, not a score. A parent who sent fifteen envelopes can
          see which fifteen; nothing here counts, ranks or rewards. */}
      <div className="flex flex-wrap gap-2 mt-3">
        <MarkButton label="Requested" on={requested} onClick={() => onToggle(listing, "requested")} />
        <MarkButton label="Received" on={received} onClick={() => onToggle(listing, "received")} />

        {received && (
          <Link
            href={memoryTitle ? `/dashboard?capture=1&title=${encodeURIComponent(memoryTitle)}` : "/dashboard?capture=1"}
            onClick={() => posthog.capture("mail_memory_started", { slug: listing.slug })}
            className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#C4962A] hover:bg-[#a67d1f] text-white transition-colors"
          >
            📸 Add a memory
          </Link>
        )}
      </div>

      <button
        onClick={onReport}
        className="mt-3 text-[11px] text-[#b5aca4] hover:text-[#7a6f65] underline transition-colors"
      >
        This didn&apos;t work for us
      </button>
    </div>
  );
}

function MarkButton({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
        on
          ? "bg-[#eef5ec] text-[#3d7045] border-[#3d7045]"
          : "bg-white text-[#8B7E74] border-[#e8e5e0] hover:border-[#5c7f63]"
      }`}
    >
      {on ? <Check size={13} /> : <Mailbox size={13} />}
      {label}
    </button>
  );
}
