export const CALENDAR_REFUSAL_NOTE = "Plan date sync is paused: this device's calendar day differs from your account's calendar day.";
export const CALENDAR_REFUSAL_HELP = "Check this device's date and time zone. If they are correct, contact Rooted support to review your account time zone. After the calendars agree, choose Retry date sync. Rooted won't change your time zone for you.";
export const CASCADE_CALENDAR_NOTE = "This device and your account use different calendar-day boundaries, so this shift is paused. No lessons moved. Check your device's date and time zone; if they are correct, contact Rooted support to review your account time zone. After they agree, cancel and choose the move again.";
export function isCalendarRefusal(reason?: string): boolean {
  return ['calendar_mismatch', 'day_window', 'local_day', 'time_zone'].includes(reason ?? '');
}

export type ReconcileBlock = { kind: 'calendar' | 'refused'; day: string; retryAt: number };
/** Owner-scoped, minimal session state: never store lesson data or credentials. */
export function readReconcileBlock(storage: Pick<Storage,'getItem'>, userId: string): ReconcileBlock | null {
  try {
    const value=JSON.parse(storage.getItem(`rooted:date-sync:${userId}`) ?? 'null');
    if (!value || !['calendar','refused'].includes(value.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Number.isFinite(value.retryAt)) return null;
    return value;
  } catch { return null; }
}
export function saveReconcileBlock(storage: Pick<Storage,'setItem'|'removeItem'>, userId: string, block: ReconcileBlock | null) {
  try {
    const key=`rooted:date-sync:${userId}`;
    if(block) storage.setItem(key,JSON.stringify(block)); else storage.removeItem(key);
  } catch { /* Storage may be disabled; in-memory refusal still remains. */ }
}
