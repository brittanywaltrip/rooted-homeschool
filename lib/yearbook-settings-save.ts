/**
 * Save one yearbook setting (a theme, or one section toggle) without
 * overwriting the others.
 *
 * profiles.yearbook_settings is one jsonb object. The editor used to write the
 * whole object from its own copy, so two controls saving at once, or two tabs,
 * replaced each other's choices with stale values: turning a section off in one
 * tab and changing the theme in another left whichever landed last, with the
 * other change silently undone.
 *
 * Now each save changes only its key, and only on top of what the database
 * holds: read the stored object, set the one key, and write it back on the
 * condition that the stored object is still what was read (compare and swap).
 * If another save got in between, read again and repeat.
 *
 * Every write is guarded. There is deliberately no unconditional fallback:
 * "the stored object looked unchanged on a re-read" does not make a plain write
 * safe, because another tab can save between that re-read and the write, and
 * the plain write would then erase its choice. When the guarded attempts cannot
 * confirm the save, the caller gets SettingsConflictError, which the editor
 * shows as "Didn't save" with Try again.
 *
 * Pure: the database is injected, so node --test can exercise every branch.
 * (profileSettingsDb below is the real adapter; its import is type-only.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SettingsRecord = Record<string, unknown>;

export type SettingsDb = {
  /** The stored object, or null when the family has never saved one. Throws on a failed read. */
  read(): Promise<SettingsRecord | null>;
  /**
   * Write `next` only if the stored object still equals `expected`. Resolves
   * the stored object after the write, or null when nothing matched. Throws on
   * an error.
   */
  swap(expected: SettingsRecord | null, next: SettingsRecord): Promise<SettingsRecord | null>;
};

export class SettingsConflictError extends Error {
  constructor() {
    super("Yearbook settings kept changing while saving");
    this.name = "SettingsConflictError";
  }
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Same settings regardless of key order; null and {} are not the same. */
export function sameSettings(a: SettingsRecord | null, b: SettingsRecord | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * Set `key` to `value` in the stored settings, keeping every other key as the
 * database holds it. Resolves the stored object once the write is confirmed.
 */
export async function saveSettingKey(
  db: SettingsDb,
  key: string,
  value: unknown,
  maxAttempts = 4,
): Promise<SettingsRecord> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await db.read();
    // Already stored (another tab made the same choice): confirmed, no write.
    if (current && sameSettings({ v: current[key] }, { v: value })) return current;
    const next = { ...(current ?? {}), [key]: value };
    const written = await db.swap(current, next);
    if (written) return written;
    // The guard matched nothing: someone else saved in between (or the
    // stored object changed shape). Go round, reading what is stored now.
  }
  throw new SettingsConflictError();
}

/** The stored yearbook_settings as an object, or null for none or a non-object. */
function asSettings(v: unknown): SettingsRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as SettingsRecord) : null;
}

/**
 * The one database adapter for profiles.yearbook_settings, shared by the
 * editor and the reader. Every call reads its result: an error throws, and a
 * write that touched no row is never treated as saved.
 */
export function profileSettingsDb(client: SupabaseClient, userId: string): SettingsDb {
  return {
    async read() {
      const { data, error } = await client.from("profiles").select("yearbook_settings").eq("id", userId).single();
      if (error) throw error;
      return asSettings((data as { yearbook_settings?: unknown } | null)?.yearbook_settings);
    },
    async swap(expected, next) {
      const base = client.from("profiles").update({ yearbook_settings: next }).eq("id", userId);
      // jsonb equality is by value, so key order in the literal does not matter.
      const guarded = expected === null
        ? base.is("yearbook_settings", null)
        : base.eq("yearbook_settings", JSON.stringify(expected));
      const { data, error } = await guarded.select("yearbook_settings");
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return asSettings((data[0] as { yearbook_settings?: unknown }).yearbook_settings) ?? next;
    },
  };
}
