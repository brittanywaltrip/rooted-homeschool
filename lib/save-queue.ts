/**
 * One place that decides when a typed answer has really been saved.
 *
 * The yearbook editor saves dozens of fields as a mother types. Before this
 * module each field ran its own setTimeout and fired its write without reading
 * the result, so a rejected write still showed "Saved", two writes for the same
 * field could land in either order (the older text winning), and leaving the
 * page dropped whatever was still waiting on its timer.
 *
 * The rules, per field key:
 *   - A debounced edit waits `delayMs`, then is committed as the field's newest
 *     version. A newer edit inside the window replaces it.
 *   - At most one write per key is in flight. A version committed while one is
 *     in flight is written after it finishes, so the database always ends on
 *     the newest text and an older write can never land after a newer one.
 *   - "saved" means the newest committed version was confirmed by the writer.
 *     A writer confirms by resolving; it reports failure by throwing.
 *   - A failed write is not retried by itself. The key stays "error" until the
 *     field is edited again, `retry(key)` runs, or `flush()` runs.
 *   - `flush()` writes everything that is waiting or failed, now, and reports
 *     which keys still failed. Navigation and "Save all changes" use it.
 *
 * The queue never holds the only copy of the text: the page's own state does.
 * The queue only decides what to write and what to say about it.
 *
 * Pure: no React, no Supabase, no "@/" imports, so node --test can load it.
 */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export type SaveWriter<T> = (value: T) => Promise<void>;

type Timer = ReturnType<typeof setTimeout>;

type Entry = {
  /** Newest committed value and the writer that knows where it goes. */
  value: unknown;
  write: SaveWriter<unknown>;
  version: number;
  savedVersion: number;
  /** The version whose write failed, while it is still the newest. */
  failedVersion: number;
  error: unknown;
  /** A debounced edit not yet committed. */
  timer: Timer | null;
  pendingValue: unknown;
  pendingWrite: SaveWriter<unknown> | null;
  inFlight: Promise<void> | null;
  /** "saved" fades back to "idle" after savedResetMs. */
  showSaved: boolean;
  savedTimer: Timer | null;
};

export type SaveQueueOptions = {
  /** How long "saved" stays before the field goes quiet. 0 keeps it. */
  savedResetMs?: number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
};

export type FlushResult = { ok: boolean; failed: string[] };

export type SaveQueue = {
  /** Debounced save: the edit is written `delayMs` after the last change. */
  schedule<T>(key: string, value: T, write: SaveWriter<T>, delayMs: number): void;
  /** Immediate save. Resolves true once this value (or a newer one) is confirmed. */
  saveNow<T>(key: string, value: T, write: SaveWriter<T>): Promise<boolean>;
  /** Write the key's newest value again. Resolves true when confirmed. */
  retry(key: string): Promise<boolean>;
  /** Write every waiting or failed key now and wait for every write. */
  flush(): Promise<FlushResult>;
  status(key: string): SaveState;
  error(key: string): unknown;
  failedKeys(): string[];
  /** True while anything is waiting, writing, or failed. */
  hasUnsaved(): boolean;
  subscribe(listener: () => void): () => void;
  /** Changes whenever any status changes (for useSyncExternalStore). */
  getSnapshot(): number;
  /** Stop timers. Does not write: call flush() first if the edits matter. */
  dispose(): void;
};

export function createSaveQueue(options: SaveQueueOptions = {}): SaveQueue {
  const savedResetMs = options.savedResetMs ?? 3000;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((t: Timer) => clearTimeout(t));

  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let snapshot = 0;

  function notify() {
    snapshot++;
    for (const l of listeners) l();
  }

  function entryFor(key: string): Entry {
    let e = entries.get(key);
    if (!e) {
      e = {
        value: undefined,
        write: async () => {},
        version: 0,
        savedVersion: 0,
        failedVersion: 0,
        error: null,
        timer: null,
        pendingValue: undefined,
        pendingWrite: null,
        inFlight: null,
        showSaved: false,
        savedTimer: null,
      };
      entries.set(key, e);
    }
    return e;
  }

  function commit(e: Entry, value: unknown, write: SaveWriter<unknown>) {
    e.value = value;
    e.write = write;
    e.version++;
    e.showSaved = false;
    if (e.savedTimer) { clearTimer(e.savedTimer); e.savedTimer = null; }
  }

  function commitPending(e: Entry) {
    if (!e.timer) return;
    clearTimer(e.timer);
    e.timer = null;
    if (e.pendingWrite) commit(e, e.pendingValue, e.pendingWrite);
    e.pendingWrite = null;
    e.pendingValue = undefined;
  }

  function drain(e: Entry): Promise<void> {
    if (e.inFlight) return e.inFlight; // the running loop picks up newer versions
    if (e.savedVersion >= e.version || e.failedVersion === e.version) return Promise.resolve();
    e.inFlight = (async () => {
      try {
        while (e.savedVersion < e.version && e.failedVersion !== e.version) {
          const v = e.version;
          const value = e.value;
          const write = e.write;
          notify();
          try {
            await write(value);
            e.savedVersion = v;
            if (e.version === v) e.error = null;
          } catch (err) {
            // A newer version committed while this one was in flight goes next;
            // its write supersedes this failure. Otherwise stop and say so.
            if (e.version === v) {
              e.failedVersion = v;
              e.error = err;
            }
          }
        }
      } finally {
        e.inFlight = null;
        if (e.savedVersion >= e.version && !e.timer) {
          e.showSaved = true;
          if (savedResetMs > 0) {
            if (e.savedTimer) clearTimer(e.savedTimer);
            e.savedTimer = setTimer(() => {
              e.savedTimer = null;
              e.showSaved = false;
              notify();
            }, savedResetMs);
          }
        }
        notify();
      }
    })();
    return e.inFlight;
  }

  function stateOf(e: Entry | undefined): SaveState {
    if (!e) return "idle";
    if (e.timer) return "pending";
    if (e.inFlight) return "saving";
    if (e.failedVersion === e.version && e.version > 0) return "error";
    if (e.savedVersion < e.version) return "pending";
    return e.showSaved ? "saved" : "idle";
  }

  function failedKeys(): string[] {
    const out: string[] = [];
    for (const [k, e] of entries) if (stateOf(e) === "error") out.push(k);
    return out;
  }

  async function confirmed(e: Entry, v: number): Promise<boolean> {
    await drain(e);
    // A later edit may have arrived and still be waiting or writing; this call
    // only answers for the version it asked about.
    while (e.inFlight) await e.inFlight;
    return e.savedVersion >= v;
  }

  return {
    schedule(key, value, write, delayMs) {
      const e = entryFor(key);
      if (e.timer) clearTimer(e.timer);
      e.pendingValue = value;
      e.pendingWrite = write as SaveWriter<unknown>;
      e.showSaved = false;
      e.timer = setTimer(() => {
        e.timer = null;
        if (e.pendingWrite) commit(e, e.pendingValue, e.pendingWrite);
        e.pendingWrite = null;
        e.pendingValue = undefined;
        void drain(e);
        notify();
      }, delayMs);
      notify();
    },

    saveNow(key, value, write) {
      const e = entryFor(key);
      if (e.timer) { clearTimer(e.timer); e.timer = null; e.pendingWrite = null; e.pendingValue = undefined; }
      commit(e, value, write as SaveWriter<unknown>);
      const v = e.version;
      notify();
      return confirmed(e, v);
    },

    retry(key) {
      const e = entries.get(key);
      if (!e) return Promise.resolve(true);
      commitPending(e);
      if (e.failedVersion === e.version) e.failedVersion = 0;
      const v = e.version;
      notify();
      return confirmed(e, v);
    },

    async flush() {
      const waits: Promise<boolean>[] = [];
      for (const e of entries.values()) {
        commitPending(e);
        if (e.failedVersion === e.version) e.failedVersion = 0;
        if (e.savedVersion < e.version || e.inFlight) waits.push(confirmed(e, e.version));
      }
      notify();
      await Promise.all(waits);
      const failed = failedKeys();
      return { ok: failed.length === 0, failed };
    },

    status(key) {
      return stateOf(entries.get(key));
    },

    error(key) {
      return entries.get(key)?.error ?? null;
    },

    failedKeys,

    hasUnsaved() {
      for (const e of entries.values()) {
        if (e.timer || e.inFlight || e.savedVersion < e.version) return true;
      }
      return false;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    getSnapshot() {
      return snapshot;
    },

    dispose() {
      for (const e of entries.values()) {
        if (e.timer) { clearTimer(e.timer); e.timer = null; }
        if (e.savedTimer) { clearTimer(e.savedTimer); e.savedTimer = null; }
      }
      listeners.clear();
    },
  };
}
