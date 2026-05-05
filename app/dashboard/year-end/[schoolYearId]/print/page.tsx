"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Photo = {
  id: string;
  photo_url: string | null;
  title: string | null;
  caption: string | null;
  date: string | null;
};

type Badge = { badge_type: string; tier: string; earned_at: string | null };

type ChildData = {
  id: string;
  name: string;
  subjects: string[];
  badges: { badge_type: string; tier: string }[];
};

type FamilyStats = {
  total_reactions: number;
  total_comments: number;
  most_loved_memory: {
    id: string;
    photo_url: string | null;
    type: string;
    title: string | null;
    reaction_count: number;
  } | null;
  top_comment: {
    body: string;
    commenter_name: string;
    created_at: string | null;
  } | null;
};

type SummaryData = {
  schoolYear: { id: string; name: string; start_date: string; end_date: string; status: string };
  profile: { first_name: string | null; last_name: string | null; display_name?: string | null };
  totalLessonsCompleted: number;
  totalLessonsPlanned: number;
  totalMinutes: number;
  memories: { type: string; count: number }[];
  badges: Badge[];
  photos?: Photo[];
  familyStats?: FamilyStats;
  familyPhotoUrl?: string | null;
  childrenData?: ChildData[];
};

const BADGE_LABELS: Record<string, string> = {
  "deep-roots": "Deep Roots",
  "growth": "Growth",
  "memory-keeper": "Memory Keeper",
  "bookworm": "Bookworm",
  "rhythm": "Rhythm",
  "flame": "On Fire",
  "explorer": "Explorer",
};

const BADGE_INFO: Record<string, { emoji: string }> = {
  "On Fire":       { emoji: "🔥" },
  "Memory Keeper": { emoji: "📸" },
  "Rhythm":        { emoji: "🎵" },
  "Deep Roots":    { emoji: "🌱" },
  "Growth":        { emoji: "📈" },
};

function badgeDisplayName(type: string): string {
  if (BADGE_LABELS[type]) return BADGE_LABELS[type];
  return type
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function familyNameFor(profile: SummaryData["profile"]): string {
  return (
    profile.display_name?.trim() ||
    profile.last_name?.trim() ||
    profile.first_name?.trim() ||
    "Family"
  );
}

function tagline(familyName: string, lessons: number, memoriesCount: number): string {
  if (lessons >= 50) {
    return `${familyName} showed up ${lessons} times this year. That's what homeschooling looks like.`;
  }
  if (lessons >= 20) {
    return `${lessons} lessons. ${memoriesCount} memories. One whole year of choosing your kids.`;
  }
  return "Every lesson, every memory. This was your year.";
}

const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 0.75in; }
  body { background: white !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Hide everything — then reveal only the keepsake */
  body * { visibility: hidden !important; }
  .no-print { display: none !important; }
  .keepsake-wrapper, .keepsake-wrapper * { visibility: visible !important; }
  .keepsake-wrapper {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    overflow: visible !important;
    background: white !important;
    z-index: auto !important;
    padding: 0 !important;
    display: block !important;
  }
  .keepsake-page {
    max-width: 100% !important;
    width: 100% !important;
    padding: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
}
@media screen {
  body { background: #f8f7f4; }
  .keepsake-wrapper {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: #f8f7f4;
    z-index: 9999;
    display: flex;
    justify-content: center;
    padding: 2rem;
  }
  .keepsake-page {
    background: white;
    max-width: 780px;
    width: 100%;
    padding: 2.5rem;
    border-radius: 12px;
    height: fit-content;
  }
}
`;

export default function YearEndPrintPage() {
  const params = useParams<{ schoolYearId: string }>();
  const schoolYearId = params?.schoolYearId;
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [erroredPhotos, setErroredPhotos] = useState<Set<string>>(new Set());
  const [mostLovedImageErrored, setMostLovedImageErrored] = useState(false);
  const [familyPhotoErrored, setFamilyPhotoErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!schoolYearId) return;
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          if (!cancelled) setError("Please sign in to view your keepsake.");
          return;
        }
        const res = await fetch(`/api/year-end-summary/${schoolYearId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.error || "Failed to load summary.");
          return;
        }
        const json: SummaryData = await res.json();
        if (!cancelled) {
          setData(json);
          setErroredPhotos(new Set());
          setMostLovedImageErrored(false);
          setFamilyPhotoErrored(false);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load summary.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [schoolYearId, supabase]);

  if (loading || error || !data) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        <div className="keepsake-wrapper">
          <div style={{ color: "#1a2c22" }}>{error ?? "Preparing your keepsake…"}</div>
        </div>
      </>
    );
  }

  const familyName = familyNameFor(data.profile);
  const lessons = data.totalLessonsCompleted ?? 0;
  const memoriesCount = (data.memories ?? []).reduce((s, m) => s + (m.count ?? 0), 0);
  const hours = ((data.totalMinutes ?? 0) / 60).toFixed(1);
  const headline = tagline(familyName, lessons, memoriesCount);

  const allPhotos = (data.photos ?? []).filter((p) => p.photo_url && !erroredPhotos.has(p.id));
  const photoGrid = allPhotos.slice(0, 12);
  const mostLoved = data.familyStats?.most_loved_memory ?? null;
  const childrenData = data.childrenData ?? [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="keepsake-wrapper">
        {/* No-print preview chrome */}
        <div
          className="no-print"
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Link
            href={`/dashboard/year-end/${schoolYearId}`}
            style={{
              display: "inline-block",
              background: "#fefcf9",
              border: "1px solid #e8e2d9",
              color: "#1a2c22",
              padding: "0.5rem 0.875rem",
              borderRadius: "0.75rem",
              fontSize: "0.875rem",
              textDecoration: "none",
            }}
          >
            ← Back to Summary
          </Link>
          <button
            onClick={() => window.print()}
            style={{ background: '#2D5A3D', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', marginLeft: '12px' }}
          >
            Save as PDF
          </button>
        </div>

        <div className="keepsake-page" style={{ color: "#1a2c22" }}>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: "24px", width: "auto" }} />
            <span
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                color: "#2D5A3D",
                fontWeight: 600,
              }}
            >
              Year in Review
            </span>
          </div>
          <div style={{ borderTop: "2px solid #2D5A3D", marginBottom: "1.5rem" }} />

          {/* Family photo */}
          {data.familyPhotoUrl && !familyPhotoErrored && (
            <div style={{ marginBottom: "1.5rem" }}>
              <img
                src={data.familyPhotoUrl}
                alt="Family"
                style={{ width: "100%", height: "200px", objectFit: "cover", borderRadius: "0.75rem" }}
                onError={() => setFamilyPhotoErrored(true)}
              />
            </div>
          )}

          {/* Year + tagline */}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <h1
              style={{
                fontSize: "2.25rem",
                fontWeight: 700,
                color: "#2D5A3D",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {data.schoolYear.name}
            </h1>
            <p
              style={{
                fontSize: "0.875rem",
                fontStyle: "italic",
                color: "#6b8f74",
                marginTop: "0.5rem",
                marginBottom: 0,
              }}
            >
              {headline}
            </p>
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-around",
              border: "1px solid #e8e2d9",
              borderRadius: "0.75rem",
              padding: "1rem 0",
              marginBottom: "2rem",
              background: "#fefcf9",
            }}
          >
            {[
              { value: lessons.toLocaleString(), label: "Lessons" },
              { value: hours, label: "Hours" },
              { value: memoriesCount.toLocaleString(), label: "Memories" },
            ].map((s, i) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  textAlign: "center",
                  borderLeft: i === 0 ? "none" : "1px solid #e8e2d9",
                  padding: "0 0.5rem",
                }}
              >
                <p
                  style={{
                    fontSize: "1.875rem",
                    fontWeight: 700,
                    color: "#2D5A3D",
                    margin: 0,
                    lineHeight: 1,
                  }}
                >
                  {s.value}
                </p>
                <p
                  style={{
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#7ab08a",
                    marginTop: "0.375rem",
                    marginBottom: 0,
                  }}
                >
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {/* Moment of the year */}
          {mostLoved && (
            <div
              style={{
                borderLeft: "2px solid #2D5A3D",
                paddingLeft: "1rem",
                marginBottom: "2rem",
              }}
            >
              <p
                style={{
                  fontSize: "0.625rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "#2D5A3D",
                  fontWeight: 600,
                  margin: 0,
                  marginBottom: "0.5rem",
                }}
              >
                Moment of the year
              </p>
              {mostLoved.photo_url && !mostLovedImageErrored && (
                <img
                  src={mostLoved.photo_url}
                  alt={mostLoved.title ?? ""}
                  style={{
                    width: "100%",
                    height: "120px",
                    objectFit: "cover",
                    borderRadius: "0.5rem",
                    marginBottom: "0.5rem",
                  }}
                  onError={() => setMostLovedImageErrored(true)}
                />
              )}
              <p style={{ fontSize: "0.875rem", color: "#1a2c22", margin: 0 }}>
                {mostLoved.title ?? mostLoved.type}
              </p>
            </div>
          )}

          {/* Each child's year */}
          {childrenData.length > 0 && (
            <div style={{ marginBottom: "2rem" }}>
              <p
                style={{
                  fontSize: "0.625rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  color: "#2D5A3D",
                  fontWeight: 600,
                  margin: 0,
                  marginBottom: "0.75rem",
                }}
              >
                Each child&apos;s year
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: childrenData.length >= 2 ? "1fr 1fr" : "1fr",
                  gap: "0.75rem",
                }}
              >
                {childrenData.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      border: "1px solid #e8e2d9",
                      borderRadius: "0.75rem",
                      padding: "0.875rem 1rem",
                      background: "#fefcf9",
                    }}
                  >
                    <p style={{ fontWeight: 700, color: "#2D5A3D", margin: 0, marginBottom: "0.5rem" }}>
                      {c.name}
                    </p>
                    {c.subjects.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.5rem" }}>
                        {c.subjects.map((s) => (
                          <span
                            key={s}
                            style={{
                              fontSize: "0.6875rem",
                              background: "#e8f0e9",
                              color: "#2D5A3D",
                              padding: "0.125rem 0.5rem",
                              borderRadius: "9999px",
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.badges.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                        {c.badges.map((b, i) => {
                          const name = badgeDisplayName(b.badge_type);
                          const info = BADGE_INFO[name];
                          return (
                            <span
                              key={`${b.badge_type}-${i}`}
                              style={{
                                fontSize: "0.6875rem",
                                color: "#1a2c22",
                              }}
                            >
                              {info?.emoji ?? "🏅"} {name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photo grid */}
          {photoGrid.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "0.5rem",
                marginBottom: "2rem",
              }}
            >
              {photoGrid.map((p) => (
                <img
                  key={p.id}
                  src={p.photo_url ?? undefined}
                  alt={p.title ?? p.caption ?? ""}
                  style={{
                    aspectRatio: "1 / 1",
                    width: "100%",
                    objectFit: "cover",
                    borderRadius: "0.5rem",
                  }}
                  onError={() => setErroredPhotos((prev) => {
                    if (prev.has(p.id)) return prev;
                    const next = new Set(prev);
                    next.add(p.id);
                    return next;
                  })}
                />
              ))}
            </div>
          )}

          {/* Footer */}
          <div style={{ textAlign: "center", color: "#9a8e84", fontSize: "0.75rem", marginTop: "2rem" }}>
            <p style={{ margin: 0 }}>
              Every lesson, every memory, every moment. This was your year. · rootedhomeschoolapp.com
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
