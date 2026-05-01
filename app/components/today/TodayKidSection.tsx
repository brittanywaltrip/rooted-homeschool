"use client";

// One kid's grouped section on the Today page.
//   - Kid header (avatar + name + "X of Y done") — skipped if onlyKid=true
//   - Subject group labels (UPPERCASE, alphabetic-by-time-then-name order)
//   - Lesson cards within each subject (kid color tint background, no border)
//   - "APPOINTMENTS & ACTIVITIES" subsection (kid color tint, dashed kid border)
//
// All handlers passed through from parent unchanged.

import TodayItemCard, { type CardHandlers, type CardSkin } from "./TodayItemCard";
import { FALLBACK_CHILD_COLOR, type KidSection } from "./groupItems";
import { tintFromHex, darkenHex } from "@/lib/color-tint";

type Props = {
  section: KidSection;
  /** Hide the kid header (single-kid family rule). */
  onlyKid?: boolean;
  handlers: CardHandlers;
  isPartner: boolean;
  childrenLookup: Map<string, { id: string; name: string; color: string | null }>;
  noteEditor: {
    editingNoteId: string | null;
    editingNoteText: string;
    noteSaveState: "idle" | "saving" | "saved" | "error";
    onNoteTextChange: (text: string) => void;
    onSaveNote: (lessonId: string) => void;
    onCancelEditingNote: () => void;
  };
};

export default function TodayKidSection({
  section,
  onlyKid = false,
  handlers,
  isPartner,
  childrenLookup,
  noteEditor,
}: Props) {
  const { child, subjects, apptsAndActivities, totalCount, doneCount } = section;
  const kidColor = child.color ?? FALLBACK_CHILD_COLOR;

  const lessonSkin: CardSkin = {
    background: tintFromHex(kidColor, 0.25),
    border: "none",
    titleColor: darkenHex(kidColor, 0.45),
    subtitleColor: darkenHex(kidColor, 0.30),
    accentColor: kidColor,
  };

  const apptSkin: CardSkin = {
    background: tintFromHex(kidColor, 0.18),
    border: `1px dashed ${kidColor}`,
    titleColor: darkenHex(kidColor, 0.45),
    subtitleColor: darkenHex(kidColor, 0.30),
    accentColor: kidColor,
  };

  return (
    <section className="mb-5">
      {!onlyKid && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[12px] font-medium shrink-0"
            style={{ background: kidColor }}
          >
            {child.name.charAt(0).toUpperCase()}
          </span>
          <span className="text-[13px] font-medium" style={{ color: "var(--color-text-primary, #2d2926)" }}>
            {child.name}
          </span>
          <span className="ml-auto text-[11px]" style={{ color: "var(--color-text-tertiary, #b5aca4)" }}>
            {doneCount} of {totalCount} done
          </span>
        </div>
      )}

      {Array.from(subjects.entries()).map(([subjectKey, items]) => {
        if (items.length === 0) return null;
        return (
          <div key={subjectKey} className="mb-2">
            <p
              className="text-[10px] uppercase tracking-[0.06em]"
              style={{ color: "var(--color-text-tertiary, #b5aca4)", margin: "10px 0 4px 4px" }}
            >
              {subjectKey}
            </p>
            {items.map((item) => (
              <TodayItemCard
                key={item.id}
                item={item}
                skin={lessonSkin}
                handlers={handlers}
                isPartner={isPartner}
                childrenLookup={childrenLookup}
                noteEditor={noteEditor}
                timeFormat="24h"
              />
            ))}
          </div>
        );
      })}

      {apptsAndActivities.length > 0 && (
        <div className="mb-2">
          <p
            className="text-[10px] uppercase tracking-[0.06em]"
            style={{ color: "var(--color-text-tertiary, #b5aca4)", margin: "10px 0 4px 4px" }}
          >
            Appointments &amp; Activities
          </p>
          {apptsAndActivities.map((item) => (
            <TodayItemCard
              key={item.id}
              item={item}
              skin={apptSkin}
              handlers={handlers}
              isPartner={isPartner}
              childrenLookup={childrenLookup}
              noteEditor={noteEditor}
              timeFormat="12h"
            />
          ))}
        </div>
      )}
    </section>
  );
}
