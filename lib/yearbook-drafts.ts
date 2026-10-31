/**
 * A copy of what a mother typed in the yearbook editor, kept on her device
 * until the server confirms it.
 *
 * lib/save-queue.ts makes sure "Saved" is true. It cannot help once the page is
 * gone: the browser Back button, a reload, or "Leave without saving" after a
 * failed write all drop the page's state. This keeps each typed field in
 * localStorage from the keystroke until its write is confirmed, so the editor
 * can offer it back next time.
 *
 * The rules:
 *   - Scoped by the signed-in user, the family whose book it is (a partner edits
 *     someone else's), the yearbook key and the field. Nothing crosses accounts
 *     or years.
 *   - A confirmed write clears the draft ONLY if the draft still holds the
 *     confirmed text. A newer edit typed while the older one was saving stays.
 *   - Drafts are OFFERED, never applied by themselves. A draft equal to what
 *     the server holds is dropped; one that differs is listed for the page to
 *     ask about, because the server may hold something newer from another
 *     device.
 *   - Storage can be missing or refuse writes (private browsing, quota, a
 *     locked-down webview). The store says so through `available` instead of
 *     pretending, and never throws into the page.
 *
 * Pure: no React, no "@/" imports, so node --test can load it.
 */

export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

export type DraftScope = {
  /** The signed-in account. */
  authUserId: string;
  /** The family whose yearbook this is (effectiveUserId). */
  familyUserId: string;
  yearbookKey: string;
};

export type Draft = { field: string; value: string; savedAt: string };

const PREFIX = "rooted.yearbook-draft.v1";

export function draftScopePrefix(scope: DraftScope): string {
  return `${PREFIX}|${scope.authUserId}|${scope.familyUserId}|${scope.yearbookKey}|`;
}

export type DraftStore = {
  /** False when storage is missing or has refused a write. */
  readonly available: boolean;
  write(field: string, value: string): boolean;
  /** Remove the draft only if it still holds exactly `confirmedValue`. */
  clearIfConfirmed(field: string, confirmedValue: string): void;
  discard(field: string): void;
  list(): Draft[];
};

/**
 * `getStorage` is a function because touching `window.localStorage` itself can
 * throw (Safari with storage blocked) and that must count as unavailable.
 */
export function openDraftStore(getStorage: () => DraftStorage | null | undefined, scope: DraftScope): DraftStore {
  const prefix = draftScopePrefix(scope);
  let storage: DraftStorage | null = null;
  let available = false;
  try {
    storage = getStorage() ?? null;
    if (storage) {
      const probe = `${PREFIX}|probe`;
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      available = true;
    }
  } catch {
    available = false;
  }

  function read(field: string): Draft | null {
    if (!available || !storage) return null;
    try {
      const raw = storage.getItem(prefix + field);
      if (raw == null) return null;
      const parsed = JSON.parse(raw) as { value?: unknown; savedAt?: unknown };
      if (typeof parsed.value !== "string") return null;
      return { field, value: parsed.value, savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "" };
    } catch {
      return null;
    }
  }

  return {
    get available() { return available; },

    write(field, value) {
      if (!available || !storage) return false;
      try {
        storage.setItem(prefix + field, JSON.stringify({ value, savedAt: new Date().toISOString() }));
        return true;
      } catch {
        // Quota or a revoked permission. From here on the page must not claim
        // a backup copy exists.
        available = false;
        return false;
      }
    },

    clearIfConfirmed(field, confirmedValue) {
      const d = read(field);
      if (!d || d.value !== confirmedValue) return;
      try { storage?.removeItem(prefix + field); } catch { /* nothing to undo */ }
    },

    discard(field) {
      if (!available || !storage) return;
      try { storage.removeItem(prefix + field); } catch { /* nothing to undo */ }
    },

    list() {
      if (!available || !storage) return [];
      const out: Draft[] = [];
      try {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(prefix)) keys.push(k);
        }
        for (const k of keys) {
          const d = read(k.slice(prefix.length));
          if (d) out.push(d);
        }
      } catch {
        return out;
      }
      return out.sort((a, b) => a.field.localeCompare(b.field));
    },
  };
}

/**
 * Split drafts into the ones to offer and the ones already on the server.
 * `serverValue` returns what the server holds for a field, undefined when it
 * holds nothing (treated as empty).
 */
export function triageDrafts(
  drafts: readonly Draft[],
  serverValue: (field: string) => string | undefined,
): { offer: Draft[]; alreadySaved: Draft[] } {
  const offer: Draft[] = [];
  const alreadySaved: Draft[] = [];
  for (const d of drafts) {
    if (d.value === (serverValue(d.field) ?? "")) alreadySaved.push(d);
    else offer.push(d);
  }
  return { offer, alreadySaved };
}
