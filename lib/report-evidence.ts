/** Pure selection rules for evidence included in Hours & Attendance. */

export interface ReportPhoto {
  id: string;
  child_id: string | null;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  date: string;
  lesson_id: string | null;
}

/**
 * Select dated photo evidence for one report.
 *
 * A family photo belongs in a child's report unless it was explicitly assigned
 * to a different child. This mirrors Rooted's whole-family activity rule and
 * avoids losing shared co-op, field-trip, or project evidence.
 */
export function selectReportPhotos(
  photos: ReadonlyArray<ReportPhoto>,
  childId: string | null,
  dateFrom: string,
  dateTo: string,
): ReportPhoto[] {
  return photos
    .filter((photo) => {
      if (!photo.photo_url) return false;
      if (childId && photo.child_id && photo.child_id !== childId) return false;
      return photo.date >= dateFrom && photo.date <= dateTo;
    })
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
