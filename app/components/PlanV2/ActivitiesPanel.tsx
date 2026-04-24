"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";

/* ============================================================================
 * ActivitiesPanel — list existing activities with edit + delete, and a
 * "+ Add activity" button that opens the shared ActivitySetupModal.
 *
 * Pure presentational. Parent owns the modal mount + DB mutations + audit
 * events. Delete goes through a confirm toast in the parent — the button
 * here just calls onDelete(activity).
 * ==========================================================================*/

export type ActivityRow = {
  id: string;
  name: string;
  emoji: string;
};

export interface ActivitiesPanelProps {
  activities: ActivityRow[];
  onCreate: () => void;
  onEdit: (activity: ActivityRow) => void;
  onDelete: (activity: ActivityRow) => void;
}

export default function ActivitiesPanel(props: ActivitiesPanelProps) {
  const { activities, onCreate, onEdit, onDelete } = props;

  return (
    <section className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ede8]">
        <span aria-hidden className="text-base leading-none">🏃</span>
        <h2 className="flex-1 text-[13px] font-semibold text-[#2d2926]">Activities</h2>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1 text-[11px] font-semibold bg-[#7C3AED] hover:bg-[#6b2fd4] text-white rounded-lg px-2.5 py-1.5 transition-colors"
        >
          <Plus size={12} /> Add activity
        </button>
      </header>

      {activities.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-[12px] text-[#7a6f65]">
            Track music lessons, co-op, sports — anything recurring outside your curriculum.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#f0ede8]">
          {activities.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[18px] leading-none shrink-0" aria-hidden>{a.emoji}</span>
              <p className="flex-1 min-w-0 text-[13px] font-medium text-[#2d2926] truncate">{a.name}</p>
              <button
                type="button"
                onClick={() => onEdit(a)}
                aria-label={`Edit ${a.name}`}
                className="w-7 h-7 flex items-center justify-center rounded-full text-[#7a6f65] hover:text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(a)}
                aria-label={`Delete ${a.name}`}
                className="w-7 h-7 flex items-center justify-center rounded-full text-[#b5aca4] hover:text-[#b91c1c] hover:bg-[#fef2f2] transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
