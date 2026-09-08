/* ============================================================================
 * The phantom-completion fingerprint.
 *
 * Pure, and in its own file so it can be tested. It used to live inside
 * repair-phantom-completions.ts, which builds a service-role client and calls
 * main() at import time — so importing it from a test either exits the process
 * or runs the repair. The one piece of that script worth unit-testing was
 * therefore the one piece nothing could reach.
 *
 * This decides which rows a DESTRUCTIVE repair will touch. It is worth a test.
 * ==========================================================================*/

type SplitTs = { ms: number; micros: string }

/**
 * Split a Postgres timestamp into millisecond instant + the sub-millisecond
 * digits, so a comparison can use both. Shared by the exact fingerprint and
 * the near-miss counter below.
 */
function splitTimestamp(ts: string): SplitTs | null {
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/)
  if (!m) return null
  const [, day, time, frac = '', zone] = m
  const fracPadded = (frac + '000000').slice(0, 6)
  const millis = fracPadded.slice(0, 3)
  const micros = fracPadded.slice(3, 6)
  // Normalise the zone. PostgREST hands back '+00:00'; psql and a few
  // client paths hand back '+00', which Date.parse rejects outright — and a
  // rejected parse here would report "no damage found" rather than an error,
  // which is the worst possible failure for this script. A zone-less stamp
  // is UTC.
  const zoneRaw = zone?.trim() ?? ''
  const zoneNorm =
    zoneRaw.length === 0
      ? 'Z'
      : /^[+-]\d{2}$/.test(zoneRaw)
        ? `${zoneRaw}:00`
        : zoneRaw
  const ms = Date.parse(`${day}T${time}.${millis}${zoneNorm}`)
  if (Number.isNaN(ms)) return null
  return { ms, micros }
}

export function isExactly24hApart(completedAt: string, updatedAt: string): boolean {
  const a = splitTimestamp(completedAt)
  const b = splitTimestamp(updatedAt)
  if (!a || !b) return false
  return b.ms - a.ms === 86_400_000 && a.micros === b.micros
}

/**
 * Close to the fingerprint, but not it.
 *
 * The fingerprint is exact to the microsecond, which is what makes it a
 * fingerprint rather than a guess — but it is also what makes it fragile. ANY
 * update to a swept row bumps `updated_at` and the row stops matching, so a
 * queue_position realignment run before this script permanently hides the rows
 * it was about to repair. That is not hypothetical: it happened on the Harrison
 * account on 2026-09-08 and cost two rows a manual check.
 *
 * This finds rows sitting within a minute either side of 24h — far too close to
 * be coincidence, not close enough to revert automatically. They are REPORTED,
 * never touched: a row this script cannot positively identify is a row a person
 * should look at.
 */
export function isNearFingerprint(completedAt: string, updatedAt: string): boolean {
  if (isExactly24hApart(completedAt, updatedAt)) return false
  const a = splitTimestamp(completedAt)
  const b = splitTimestamp(updatedAt)
  if (!a || !b) return false
  const delta = b.ms - a.ms
  return Math.abs(delta - 86_400_000) <= 60_000
}
