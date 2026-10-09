/** These structured commit responses occur only after the operation lock and
 * receipt lookup. They prove the retained operation did not commit. Transport
 * errors, busy, generic invalid results and Undo's later_edit do not prove it.
 * Keep this allowlist aligned with the fixed commit RPCs, not error messages.
 */
export function isDefinitiveSchedulerRejection(result: {status: string; reason?: string}): boolean {
  return result.status === 'stale' && [
    'schedule_changed', 'local_day_changed', 'placement_changed', 'already_completed', 'mode', 'local_day', 'continuation_exists', 'goal_not_empty_or_recent', 'slot_occupied_or_invalid', 'history_list',
  ].includes(result.reason ?? '');
}
