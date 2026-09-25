export type OneOffLessonChoice = { subject: string; title: string; label: string };

/** Reuse the family's own titles, never generated curriculum placeholders. */
export function reusableOneOffLessons(rows: { title: string | null }[]): OneOffLessonChoice[] {
  const seen = new Set<string>();
  const choices: OneOffLessonChoice[] = [];
  for (const row of rows) {
    const saved = row.title?.trim();
    if (!saved || /^.+ — Lesson \d+$/.test(saved)) continue;
    const split = saved.indexOf(" · ");
    const subject = split > 0 && split <= 40 ? saved.slice(0, split).trim() : "";
    const title = subject ? saved.slice(split + 3).trim() : saved;
    if (!title && !subject) continue;
    const key = saved.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ subject, title, label: saved });
    if (choices.length === 60) break;
  }
  return choices;
}
