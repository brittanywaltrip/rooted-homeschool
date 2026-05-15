"use client";

import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";

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
  const { activities, onEdit, onDelete } = props;
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  return (
    <section className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[#f0ede8]">
        <span aria-hidden className="text-base leading-none">🏃</span>
        <h2 className="flex-1 text-[13px] font-semibold text-[#2d2926]">Activities</h2>
        {/* Add activity has moved to the unified "+" sheet in the Plan hero. */}
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
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuOpenId((id) => (id === a.id ? null : a.id))}
                  aria-label={`More actions for ${a.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === a.id}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-[#7a6f65] hover:text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
                >
                  <MoreVertical size={16} />
                </button>
                {menuOpenId === a.id ? (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpenId(null)}
                      aria-hidden
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-[#e8e2d9] overflow-hidden min-w-[160px]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setMenuOpenId(null); onEdit(a); }}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
                      >
                        <Pencil size={14} className="text-[#5c7f63]" /> Edit schedule
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setMenuOpenId(null); onDelete(a); }}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#b91c1c] hover:bg-[#fef2f2] flex items-center gap-2"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
