// Tests for lib/resource-share.ts: the shared link and line, slug rules, the
// /r/ lookup, the page metadata, and the signup handoff.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findSharedResource,
  findSlugConflict,
  isInternalResourceUrl,
  landingSignupHref,
  parseShareSource,
  readShareSource,
  resourceCopyText,
  resourceOgImage,
  resourcePageMetadata,
  resourceShareKey,
  resourceShareText,
  resourceShareUrl,
  resourceSlug,
  safeNextPath,
  shareSourceEventProps,
  validateResourceSlug,
  type SharedResource,
} from "./resource-share.ts";

const ID = "708a55d9-0452-429e-bd7a-b5d309d6ced4";

function row(over: Partial<SharedResource> = {}): SharedResource {
  return {
    id: ID, title: "Leaf Hunt and Rubbings", description: "Go find leaves.", url: "https://example.com/leaf",
    grade_level: "All Ages", metadata: { slug: "leaf-hunt" }, active: true, ...over,
  };
}

test("the share line is exactly title + ', free from Rooted Homeschool App'", () => {
  assert.equal(resourceShareText("Leaf Hunt"), "Leaf Hunt, free from Rooted Homeschool App");
});

test("share url and copy text", () => {
  assert.equal(resourceShareUrl("leaf-hunt"), "https://rootedhomeschoolapp.com/r/leaf-hunt");
  assert.equal(
    resourceCopyText("Leaf Hunt", "leaf-hunt"),
    "Leaf Hunt, free from Rooted Homeschool App https://rootedhomeschoolapp.com/r/leaf-hunt",
  );
});

test("the share key is the slug when set and valid, the id otherwise", () => {
  assert.equal(resourceShareKey({ id: ID, metadata: { slug: "leaf-hunt" } }), "leaf-hunt");
  assert.equal(resourceShareKey({ id: ID, metadata: {} }), ID);
  assert.equal(resourceShareKey({ id: ID, metadata: null }), ID);
  assert.equal(resourceShareKey({ id: ID, metadata: { slug: "Bad Slug" } }), ID);
  assert.equal(resourceShareKey({ id: ID, metadata: { slug: 7 } }), ID);
});

test("slug validation", () => {
  assert.equal(validateResourceSlug(""), null);
  assert.equal(validateResourceSlug("leaf-hunt"), null);
  assert.equal(validateResourceSlug("abc"), null);
  assert.equal(validateResourceSlug("a".repeat(40)), null);
  assert.match(validateResourceSlug("ab")!, /3 to 40/);
  assert.match(validateResourceSlug("a".repeat(41))!, /3 to 40/);
  assert.match(validateResourceSlug("Leaf-Hunt")!, /lowercase/);
  assert.match(validateResourceSlug("leaf hunt")!, /lowercase/);
  assert.match(validateResourceSlug("leaf_hunt")!, /lowercase/);
  assert.match(validateResourceSlug(ID)!, /id/);
  assert.equal(resourceSlug({ slug: " leaf-hunt " }), "leaf-hunt");
});

test("slug uniqueness counts active rows other than the one being edited", () => {
  const rows = [
    { id: "a", active: true, metadata: { slug: "leaf-hunt" } },
    { id: "b", active: false, metadata: { slug: "old-pack" } },
    { id: "c", active: true, metadata: {} },
  ];
  assert.equal(findSlugConflict("leaf-hunt", rows, null)?.id, "a");
  assert.equal(findSlugConflict("leaf-hunt", rows, "a"), null);
  assert.equal(findSlugConflict("old-pack", rows, null), null);
  assert.equal(findSlugConflict("new-one", rows, null), null);
  assert.equal(findSlugConflict("", rows, null), null);
});

function lookups(bySlug: Record<string, SharedResource>, byId: Record<string, SharedResource>) {
  const calls: string[] = [];
  return {
    calls,
    lookup: {
      bySlug: async (s: string) => { calls.push(`slug:${s}`); return bySlug[s] ?? null; },
      byId: async (i: string) => { calls.push(`id:${i}`); return byId[i] ?? null; },
    },
  };
}

test("/r/leaf-hunt resolves by slug", async () => {
  const { lookup, calls } = lookups({ "leaf-hunt": row() }, {});
  assert.equal((await findSharedResource("leaf-hunt", lookup))?.id, ID);
  assert.deepEqual(calls, ["slug:leaf-hunt"]);
});

test("/r/{uuid} resolves by id, and never asks the slug lookup", async () => {
  const { lookup, calls } = lookups({}, { [ID]: row({ metadata: {} }) });
  assert.equal((await findSharedResource(ID, lookup))?.id, ID);
  assert.equal((await findSharedResource(ID.toUpperCase(), lookup))?.id, ID);
  assert.ok(calls.every((c) => c.startsWith("id:")));
});

test("inactive or unknown resolves to nothing (the page 404s)", async () => {
  const { lookup } = lookups({ "leaf-hunt": row({ active: false }) }, { [ID]: row({ active: false }) });
  assert.equal(await findSharedResource("leaf-hunt", lookup), null);
  assert.equal(await findSharedResource(ID, lookup), null);
  assert.equal(await findSharedResource("nope-nope", lookup), null);
  assert.equal(await findSharedResource("", lookup), null);
  assert.equal(await findSharedResource("%E0%A4%A", lookup), null);
  assert.equal(await findSharedResource("Not A Slug!", lookup), null);
});

test("page metadata uses the card image when there is one", () => {
  const m = resourcePageMetadata({ title: "Leaf Hunt", description: "Go find leaves.", subject: "Science", image: "/resources/fall/leaf-hunt.webp" });
  assert.deepEqual(m.title, { absolute: "Leaf Hunt | Rooted Homeschool App" });
  assert.equal(m.description, "Go find leaves.");
  assert.deepEqual(m.openGraph.images, ["/resources/fall/leaf-hunt.webp"]);
  assert.equal(m.twitter.card, "summary_large_image");
});

test("page metadata falls back to the OG route when there is no image", () => {
  const m = resourcePageMetadata({ title: "Pumpkin Math & More", description: null, subject: "Math", image: null });
  const img = m.openGraph.images[0];
  assert.ok(img.startsWith("/api/og?"), img);
  const q = new URLSearchParams(img.split("?")[1]);
  assert.equal(q.get("kind"), "resource");
  assert.equal(q.get("title"), "Pumpkin Math & More");
  assert.equal(q.get("subject"), "Math");
  assert.equal(m.description, "Pumpkin Math & More, free from Rooted Homeschool App");
  assert.equal(new URLSearchParams(resourceOgImage({ title: "X", subject: null, image: null }).split("?")[1]).has("subject"), false);
});

test("internal urls and safe next paths", () => {
  assert.equal(isInternalResourceUrl("/dashboard/printables/first-day?theme=fall"), true);
  assert.equal(isInternalResourceUrl("https://example.com"), false);
  assert.equal(isInternalResourceUrl("//evil.com"), false);
  assert.equal(isInternalResourceUrl(null), false);
  assert.equal(safeNextPath("/dashboard/printables/first-day?theme=fall"), "/dashboard/printables/first-day?theme=fall");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "dashboard", "javascript:alert(1)", "/a\nb", "", null]) {
    assert.equal(safeNextPath(bad as string | null), null, String(bad));
  }
});

test("landing signup links", () => {
  assert.equal(landingSignupHref("leaf-hunt"), "/signup?from=share&r=leaf-hunt");
  const h = landingSignupHref("fall-photo-frame", "/dashboard/printables/first-day?theme=fall");
  const q = new URLSearchParams(h.split("?")[1]);
  assert.equal(q.get("from"), "share");
  assert.equal(q.get("r"), "fall-photo-frame");
  assert.equal(q.get("next"), "/dashboard/printables/first-day?theme=fall");
  assert.equal(landingSignupHref("x-y-z", "https://evil.com"), "/signup?from=share&r=x-y-z");
});

test("signup passes from and r through to the event", () => {
  const src = parseShareSource(new URLSearchParams("from=share&r=leaf-hunt&next=/dashboard"));
  assert.deepEqual(src, { from: "share", r: "leaf-hunt", next: "/dashboard" });
  assert.deepEqual(shareSourceEventProps(src), { from: "share", r: "leaf-hunt" });
  assert.deepEqual(shareSourceEventProps(parseShareSource(new URLSearchParams(`from=share&r=${ID}`))), { from: "share", r: ID });
  assert.deepEqual(shareSourceEventProps(parseShareSource(new URLSearchParams("from=share&r=<script>"))), { from: "share" });
  assert.equal(parseShareSource(new URLSearchParams("r=leaf-hunt")), null);
  assert.equal(parseShareSource(new URLSearchParams("from=Not Valid")), null);
  assert.deepEqual(shareSourceEventProps(null), {});
});

test("the stored share source is read back defensively", () => {
  assert.deepEqual(readShareSource(JSON.stringify({ from: "share", r: "leaf-hunt", next: null })), { from: "share", r: "leaf-hunt", next: null });
  assert.equal(readShareSource("not json"), null);
  assert.equal(readShareSource(null), null);
  assert.equal(readShareSource(JSON.stringify({ from: 5 })), null);
});
