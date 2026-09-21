import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { MissingApiKeyError, requireApiKey } from "./api-keys.ts";

test("a present credential is returned, trimmed", () => {
  assert.equal(requireApiKey("STRIPE_SECRET_KEY", "sk_live_abc"), "sk_live_abc");
  assert.equal(requireApiKey("RESEND_API_KEY", "  re_abc  "), "re_abc");
});

test("a missing credential names the variable rather than the SDK's complaint", () => {
  for (const absent of [undefined, null, "", "   "]) {
    assert.throws(
      () => requireApiKey("STRIPE_SECRET_KEY", absent),
      (err: unknown) => {
        assert.ok(err instanceof MissingApiKeyError);
        assert.equal(err.envVar, "STRIPE_SECRET_KEY");
        assert.match(err.message, /STRIPE_SECRET_KEY is not set/);
        return true;
      },
      `${JSON.stringify(absent)} must not pass as a credential`,
    );
  }
});

// ─── The guard this commit exists for ────────────────────────────────────────

/**
 * Positions in `src` that are real code: not inside a comment or a string.
 * Grepping cannot tell a module-scope construction from one inside a handler,
 * and that difference is the whole point: only the module-scope ones evaluate
 * at import, and only those can fail a build.
 */
function moduleScopeConstructions(src: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let line = 1;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "\n") { line++; i++; continue; }

    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        else if (src[i] === "\n") line++;
        i++;
      }
      i++;
      continue;
    }

    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") { depth--; i++; continue; }

    for (const sdk of ["Stripe", "Resend"]) {
      if (depth === 0 && src.startsWith(`new ${sdk}(`, i)) {
        found.push(`line ${line}: new ${sdk}(`);
      }
    }
    i++;
  }
  return found;
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

test("no API route builds a Stripe or Resend client at module scope", () => {
  const apiRoot = resolve(import.meta.dirname, "..", "app", "api");
  const offenders: string[] = [];

  for (const file of routeFiles(apiRoot)) {
    for (const hit of moduleScopeConstructions(readFileSync(file, "utf8"))) {
      offenders.push(`${relative(apiRoot, file)} ${hit}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A client built at module scope throws while the route is imported, which " +
      "fails `next build` in any environment without that credential. Use " +
      "stripeClient() / resendClient() from lib/api-clients.ts instead.",
  );
});

test("the scanner tells module scope from inside a handler", () => {
  assert.deepEqual(
    moduleScopeConstructions(`const s = new Stripe(k);`),
    ["line 1: new Stripe("],
  );
  assert.deepEqual(
    moduleScopeConstructions(`export function h() {\n  const s = new Stripe(k);\n}`),
    [],
  );
  assert.deepEqual(
    moduleScopeConstructions(`// const s = new Stripe(k);`),
    [],
  );
  assert.deepEqual(
    moduleScopeConstructions(`const note = "new Stripe(";`),
    [],
  );
});
