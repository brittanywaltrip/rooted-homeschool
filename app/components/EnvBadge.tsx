"use client";

/**
 * A visible marker so nobody confuses staging for production again.
 *
 * Renders NOTHING in production, so families never see it. It shows the
 * non-secret project ref because the whole failure mode was "which database is
 * this?" being invisible.
 */
export default function EnvBadge({ env, projectRef }: { env: string; projectRef: string | null }) {
  if (env === "production") return null;
  const label = env === "staging" ? "STAGING" : env.toUpperCase();
  return (
    <div
      aria-label={`${label} environment, database ${projectRef ?? "unknown"}`}
      className="fixed bottom-2 left-2 z-[100] rounded-md bg-[#7a3d3d] px-2 py-1 font-mono text-[10px] leading-tight text-white shadow-md"
    >
      {label} · {projectRef ?? "no project"}
    </div>
  );
}
