"use client";

import { useState } from "react";
import { X } from "lucide-react";

type ListData = { id: string; name: string; emoji: string; sort_order: number; archived: boolean; created_at: string };

interface Props {
  onClose: () => void;
  onCreated: (list: ListData) => void;
  getToken: () => Promise<string | null>;
}

const LIST_EMOJIS = [
  "📝", "📋", "✅", "📌", "🗒️", "📎", "🏷️", "📐",
  "🛒", "🛍️", "🧹", "🧺", "🧴", "🪣", "🧽", "🏠",
  "📚", "✏️", "🎒", "🏫", "🎓", "📖", "🖍️", "🧪",
  "🍎", "🥗", "🧁", "☕", "🍕", "🥦", "🍳", "🛎️",
  "🎯", "💡", "🌱", "🌿", "💪", "⭐", "❤️", "✨",
  "🎵", "🎨", "📷", "🎉", "🐾", "🚗", "💊", "📅",
];

const TEMPLATES = [
  { emoji: "📋", name: "To-Do's" },
  { emoji: "🛒", name: "Shopping" },
  { emoji: "📦", name: "Supplies" },
  { emoji: "🏫", name: "Co-op Prep" },
  { emoji: "✨", name: "Custom" },
];

export default function NewListModal({ onClose, onCreated, getToken }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  const [saving, setSaving] = useState(false);

  const isCustom = selected === "Custom";
  const canCreate = selected && (isCustom ? customName.trim() : true);

  async function handleCreate() {
    if (!canCreate || saving) return;
    setSaving(true);
    const token = await getToken();
    if (!token) { setSaving(false); return; }

    const tpl = TEMPLATES.find((t) => t.name === selected);
    const name = isCustom ? customName.trim() : tpl!.name;
    const emoji = isCustom ? (customEmoji.trim() || "📝") : tpl!.emoji;

    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, emoji }),
      });
      if (!res.ok) { setSaving(false); return; }
      const data = await res.json();
      onCreated(data);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[#faf8f4] rounded-t-2xl sm:rounded-2xl shadow-2xl z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e2d9]">
          <h2 className="text-base font-medium text-[var(--g-deep)]" style={{ fontFamily: "var(--font-display)" }}>
            New list
          </h2>
          <button onClick={onClose} className="text-[#b5aca4] hover:text-[#7a6f65] transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-[#7a6f65]">Pick a template or create your own.</p>

          {/* Template grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {TEMPLATES.map((tpl) => {
              const active = selected === tpl.name;
              return (
                <button
                  key={tpl.name}
                  onClick={() => setSelected(tpl.name)}
                  className="flex items-center gap-2.5 rounded-xl p-3 text-left transition-all"
                  style={{
                    border: active ? "1.5px solid #2D5A3D" : "1.5px solid #e0ddd8",
                    background: active ? "#f0f6f1" : "white",
                  }}
                >
                  <span className="text-xl">{tpl.emoji}</span>
                  <span className="text-sm font-medium" style={{ color: active ? "#2D5A3D" : "#2d2926" }}>
                    {tpl.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom fields */}
          {isCustom && (
            <div className="rounded-xl p-3 space-y-3" style={{ border: "1.5px dashed #e0ddd8", background: "white" }}>
              <div className="flex gap-2 items-center">
                <span className="w-10 h-10 rounded-lg bg-[#f0f6f1] flex items-center justify-center text-xl shrink-0">{customEmoji || "📝"}</span>
                <input
                  type="text"
                  placeholder="List name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="flex-1 text-sm border border-[#e8e2d9] rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-[#5c7f63]"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-8 gap-1">
                {LIST_EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => setCustomEmoji(e)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all"
                    style={{ background: customEmoji === e ? "#f0f6f1" : "transparent", boxShadow: customEmoji === e ? "0 0 0 1.5px #2D5A3D" : "none" }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="w-full py-3 rounded-xl bg-[#2D5A3D] hover:opacity-90 text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            {saving ? "Creating..." : "Create list"}
          </button>
        </div>
      </div>
    </div>
  );
}
