"use client";

// "Everyone" section at the top of the Today schedule. Renders shared/whole-
// family appointments and activities. Activity completions create ONE
// activity_logs row regardless of how many kids are listed (the toggle
// handler at page.tsx:1349 enforces this — we just don't loop here).

import TodayItemCard, { type CardHandlers, type CardSkin } from "./TodayItemCard";
import type { TodayItem } from "./groupItems";

const EVERYONE_BG = "#EAE7DD";
const EVERYONE_BORDER = "1px dashed #888780";
const EVERYONE_TITLE = "#2C2C2A";
const EVERYONE_SUBTITLE = "#5C5C58";
const EVERYONE_ACCENT = "#5C5C58";

const skin: CardSkin = {
  background: EVERYONE_BG,
  border: EVERYONE_BORDER,
  titleColor: EVERYONE_TITLE,
  subtitleColor: EVERYONE_SUBTITLE,
  accentColor: EVERYONE_ACCENT,
};

type Props = {
  items: TodayItem[];
  /** All children for stacked-avatar header rendering. */
  children: { id: string; name: string; color: string | null }[];
  childrenLookup: Map<string, { id: string; name: string; color: string | null }>;
  handlers: CardHandlers;
  isPartner: boolean;
  noteEditor: {
    editingNoteId: string | null;
    editingNoteText: string;
    noteSaveState: "idle" | "saving" | "saved" | "error";
    onNoteTextChange: (text: string) => void;
    onSaveNote: (lessonId: string) => void;
    onCancelEditingNote: () => void;
  };
};

export default function TodayEveryoneSection({
  items,
  children,
  childrenLookup,
  handlers,
  isPartner,
  noteEditor,
}: Props) {
  if (items.length === 0) return null;

  return (
    <section className="mb-[18px]">
      <div className="flex items-center gap-2 mb-2 px-1">
        <div className="flex items-center" aria-hidden="true">
          {children.map((c, i) => (
            <span
              key={c.id}
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-white text-[10px] font-medium"
              style={{
                background: c.color ?? "#7a6f65",
                border: "2px solid white",
                marginLeft: i === 0 ? 0 : -8,
              }}
            >
              {c.name.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
        <span className="text-[13px] font-medium" style={{ color: "var(--color-text-primary, #2d2926)" }}>
          Everyone
        </span>
      </div>
      <p
        className="text-[10px] uppercase tracking-[0.06em]"
        style={{ color: "var(--color-text-tertiary, #b5aca4)", margin: "10px 0 4px 4px" }}
      >
        Appointments &amp; Activities
      </p>
      {items.map((item) => (
        <TodayItemCard
          key={item.id}
          item={item}
          skin={skin}
          handlers={handlers}
          isPartner={isPartner}
          childrenLookup={childrenLookup}
          noteEditor={noteEditor}
          timeFormat="12h"
        />
      ))}
    </section>
  );
}
