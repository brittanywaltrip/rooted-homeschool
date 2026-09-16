import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { resourceImagePath, resourceSubject } from "@/lib/resource-metadata";
import {
  findSharedResource,
  isInternalResourceUrl,
  landingSignupHref,
  resourcePageMetadata,
  resourceShareKey,
  type SharedResource,
} from "@/lib/resource-share";
import ResourceLandingTracker, { ResourceLandingButton } from "./ResourceLandingClient";

/**
 * The page a shared resource link opens: /r/<slug or id>.
 *
 * Public. The middleware only refreshes a session and gates nothing, and the
 * dashboard's sign-in check lives in the dashboard layout, which this route is
 * outside of, so a friend with no account reads it straight away.
 *
 * The lookup uses a plain anon client with no session: the "Public read active
 * resources" policy is what makes the row readable, and findSharedResource
 * refuses inactive rows as well, so a signed-in visitor (whose RLS can see
 * inactive rows) gets the same answer as a stranger.
 */

type Params = { slug: string };

const SELECT = "id, title, description, url, grade_level, metadata, active";

const loadResource = cache(async (param: string): Promise<SharedResource | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return findSharedResource(param, {
    bySlug: async (slug) => {
      const { data } = await db
        .from("resources")
        .select(SELECT)
        .eq("active", true)
        .eq("metadata->>slug", slug)
        .limit(1)
        .maybeSingle();
      return (data as SharedResource | null) ?? null;
    },
    byId: async (id) => {
      const { data } = await db.from("resources").select(SELECT).eq("active", true).eq("id", id).maybeSingle();
      return (data as SharedResource | null) ?? null;
    },
  });
});

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await loadResource(slug);
  if (!r) return { title: { absolute: "Not found | Rooted Homeschool App" } };
  return resourcePageMetadata({
    title: r.title,
    description: r.description,
    subject: resourceSubject(r.metadata),
    image: resourceImagePath(r.metadata),
  });
}

export default async function SharedResourcePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const r = await loadResource(slug);
  if (!r) notFound();

  const key = resourceShareKey(r);
  const image = resourceImagePath(r.metadata);
  const subject = resourceSubject(r.metadata);
  const internal = isInternalResourceUrl(r.url);

  return (
    <main className="min-h-screen bg-[#faf8f4] text-[#2d2926] flex flex-col">
      <ResourceLandingTracker resourceId={r.id} slug={key} />

      <header className="px-4 py-4 max-w-md w-full mx-auto">
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm" aria-hidden="true">🌿</span>
          <span className="font-bold text-base" style={{ fontFamily: "var(--font-display)" }}>Rooted</span>
        </Link>
      </header>

      <article className="px-4 pb-10 max-w-md w-full mx-auto flex-1">
        <div className="bg-white border border-[#e8e2d9] rounded-2xl overflow-hidden">
          {image && (
            <Image
              src={image}
              alt=""
              width={1000}
              height={1000}
              priority
              sizes="(max-width: 480px) 100vw, 448px"
              className="block w-full aspect-square object-cover"
            />
          )}
          <div className="p-5">
            <h1 className="text-2xl font-bold leading-tight mb-2" style={{ fontFamily: "var(--font-display)" }}>
              {r.title}
            </h1>
            {r.description && <p className="text-[15px] text-[#7a6f65] leading-relaxed mb-3">{r.description}</p>}
            <div className="flex gap-1.5 flex-wrap mb-5">
              {r.grade_level && (
                <span className="bg-[#e8f0e9] text-[#2d5a3d] rounded-full px-2.5 py-0.5 text-xs font-semibold">{r.grade_level}</span>
              )}
              {subject && (
                <span className="text-xs bg-[#f0ede8] text-[#7a6f65] px-2.5 py-0.5 rounded-full">{subject}</span>
              )}
            </div>

            {internal ? (
              <ResourceLandingButton
                href={landingSignupHref(key, r.url)}
                label="Make yours in Rooted"
                resourceId={r.id}
                slug={key}
                external={false}
              />
            ) : r.url ? (
              <ResourceLandingButton
                href={r.url}
                label="Get the free printable"
                resourceId={r.id}
                slug={key}
                external
              />
            ) : null}
          </div>
        </div>

        <section className="mt-6 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
          <p className="font-semibold mb-2">This came from Rooted Homeschool App.</p>
          <p className="text-[15px] text-[#7a6f65] leading-relaxed mb-4">
            Rooted is a free homeschool planner and memory keeper made by a homeschool mom. Plan the week,
            check off lessons, and keep the photos in one place.
          </p>
          <Link
            href={landingSignupHref(key)}
            className="flex items-center justify-center w-full py-3 rounded-xl border-2 border-[#2d5a3d] text-[#2d5a3d] font-semibold text-base hover:bg-[#e8f0e9] transition-colors"
          >
            Start free
          </Link>
          <p className="text-sm text-[#7a6f65] text-center mt-3">
            Already using Rooted?{" "}
            <Link href="/dashboard" className="text-[#5c7f63] underline">Open it</Link>
          </p>
        </section>
      </article>

      <footer className="border-t border-[#e8e2d9] bg-[#fefcf9]">
        <div className="max-w-md mx-auto px-4 py-6 flex items-center justify-between gap-4">
          <span className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-[#5c7f63] flex items-center justify-center text-xs" aria-hidden="true">🌿</span>
            <span className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>Rooted</span>
          </span>
          <nav className="flex gap-4 text-sm">
            <Link href="/privacy" className="text-[#7a6f65] hover:text-[#5c7f63]">Privacy</Link>
            <Link href="/terms" className="text-[#7a6f65] hover:text-[#5c7f63]">Terms</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
