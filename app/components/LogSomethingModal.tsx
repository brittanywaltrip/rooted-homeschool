"use client";

import { useState, useRef } from "react";
import { X, ChevronLeft, Send } from "lucide-react";

type ListRow = { id: string; name: string; emoji: string; sort_order: number };
type Child = { id: string; name: string; color: string | null };

type MemoryTile = { emoji: string; label: string; sub: string; action: () => void };

interface Props {
  onClose: () => void;
  onLogLesson: () => void;
  onLogActivity: () => void;
  onCaptureMemory: (type: "photo" | "drawing" | "win" | "book" | "field_trip" | "project") => void;
  lists: ListRow[];
  children: Child[];
  getToken: () => Promise<string | null>;
  onListItemAdded: () => void;
}

type Step = "main" | "capture" | "pick-list" | "add-item";

export default function LogSomethingModal({
  onClose, onLogLesson, onLogActivity, onCaptureMemory,
  lists, children, getToken, onListItemAdded,
}: Props) {
  const [step, setStep] = useState<Step>("main");
  const [selectedList, setSelectedList] = useState<ListRow | null>(null);
  const [itemText, setItemText] = useState("");
  const [itemChild, setItemChild] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedToast, setAddedToast] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function saveItem() {
    if (!itemText.trim() || !selectedList || saving) return;
    setSaving(true);
    const token = await getToken();
    if (!token) { setSaving(false); return; }
    try {
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          list_id: selectedList.id,
          text: itemText.trim(),
          child_id: itemChild || null,
        }),
      });
      if (res.ok) {
        setAddedToast(true);
        onListItemAdded();
        setTimeout(() => { setAddedToast(false); onClose(); }, 800);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  const memoryTiles: MemoryTile[] = [
    { emoji: "📸", label: "Photo",      sub: "Snap a moment",     action: () => { onClose(); onCaptureMemory("photo"); } },
    { emoji: "🎨", label: "Drawing",    sub: "Save their art",    action: () => { onClose(); onCaptureMemory("drawing"); } },
    { emoji: "🏆", label: "Win",        sub: "Celebrate a win",   action: () => { onClose(); onCaptureMemory("win"); } },
    { emoji: "📖", label: "Book",       sub: "Log a read",        action: () => { onClose(); onCaptureMemory("book"); } },
    { emoji: "🗺️", label: "Field Trip", sub: "We went somewhere", action: () => { onClose(); onCaptureMemory("field_trip"); } },
    { emoji: "🔨", label: "Project",    sub: "We made something", action: () => { onClose(); onCaptureMemory("project"); } },
  ];

  // ── Title + back button logic ──────────────────────────────────────────────

  const title = step === "main" ? "Log something"
    : step === "capture" ? "Capture a memory"
    : step === "pick-list" ? "Add to a list"
    : `${selectedList?.emoji} ${selectedList?.name}`;

  const canGoBack = step !== "main";

  function goBack() {
    if (step === "add-item") setStep("pick-list");
    else if (step === "pick-list" || step === "capture") setStep("main");
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl"
        style={{ maxWidth: 420, margin: "0 auto", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[#e8e2d9]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2">
          <div className="flex items-center gap-2">
            {canGoBack && (
              <button
                type="button"
                onClick={goBack}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#8B7E74] hover:bg-[#f2f0ec] transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="text-[18px] font-medium text-[#2D2A26]">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#f2f0ec] flex items-center justify-center text-[#8B7E74] hover:bg-[#e8e5e0] text-sm transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── MAIN MENU ── */}
        {step === "main" && (
          <div className="px-4 pb-6 pt-2 space-y-2">
            {([
              { emoji: "📚", label: "Log a lesson",      sub: "Mark lessons complete",   action: () => { onClose(); onLogLesson(); } },
              { emoji: "🎯", label: "Log an activity",   sub: "Co-op, sports, music...", action: () => { onClose(); onLogActivity(); } },
              { emoji: "📅", label: "Add appointment",   sub: "Coming soon",             disabled: true },
              { emoji: "📝", label: "Add to a list",     sub: "To-do's, shopping...",    action: () => setStep("pick-list") },
              { emoji: "📸", label: "Capture a memory",  sub: "Photo, win, book...",     action: () => setStep("capture") },
            ] as const).map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={"action" in item && item.action ? item.action : undefined}
                disabled={"disabled" in item && item.disabled}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border-[1.5px] transition-colors text-left disabled:opacity-40 disabled:cursor-default"
                style={{
                  borderColor: "#e8e5e0",
                  background: "disabled" in item && item.disabled ? "#faf9f7" : "#fafaf8",
                }}
              >
                <span className="text-[24px] shrink-0">{item.emoji}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium text-[#2D2A26] block">{item.label}</span>
                  <span className="text-[11px] text-[#8B7E74]">{item.sub}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── CAPTURE SUB-MENU (existing memory types) ── */}
        {step === "capture" && (
          <div className="px-4 pb-6">
            {/* Leaf banner */}
            <div className="bg-gradient-to-r from-[#f0f7f2] to-[#e8f5e9] rounded-xl py-2.5 px-3.5 text-center mb-3">
              <span className="text-[12px] text-[#2D5A3D] font-medium">
                🌿 Every memory earns a leaf for your garden!
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {memoryTiles.map((tile) => (
                <button
                  key={tile.label}
                  onClick={tile.action}
                  className="flex flex-col items-center justify-center py-5 px-2.5 rounded-2xl border-[1.5px] border-[#e8e5e0] bg-[#fafaf8] hover:border-[#2D5A3D] hover:bg-[#f0f7f2] transition-colors text-center"
                >
                  <span className="text-[28px] mb-1.5">{tile.emoji}</span>
                  <span className="text-[13px] font-medium text-[#2D2A26]">{tile.label}</span>
                  <span className="text-[10px] text-[#8B7E74]">{tile.sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── PICK A LIST ── */}
        {step === "pick-list" && (
          <div className="px-4 pb-6 pt-1">
            {lists.length === 0 ? (
              <p className="text-sm text-[#7a6f65] text-center py-6">
                No lists yet — create one from the My Lists section.
              </p>
            ) : (
              <div className="space-y-2">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => {
                      setSelectedList(list);
                      setItemText("");
                      setItemChild("");
                      setStep("add-item");
                      setTimeout(() => inputRef.current?.focus(), 100);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-[1.5px] border-[#e8e5e0] bg-[#fafaf8] hover:border-[#2D5A3D] hover:bg-[#f0f7f2] transition-colors text-left"
                  >
                    <span className="text-xl">{list.emoji}</span>
                    <span className="text-sm font-medium text-[#2d2926]">{list.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ADD ITEM TO LIST ── */}
        {step === "add-item" && selectedList && (
          <div className="px-4 pb-6 pt-1 space-y-4">
            {/* Added toast */}
            {addedToast && (
              <div className="bg-[#e8f5ea] border border-[#b8d9bc] rounded-xl py-2.5 px-4 text-center">
                <span className="text-sm text-[#2D5A3D] font-medium">Added!</span>
              </div>
            )}

            {!addedToast && (
              <>
                {/* Text input */}
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">
                    What do you need to add?
                  </label>
                  <input
                    ref={inputRef}
                    type="text"
                    value={itemText}
                    onChange={(e) => setItemText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveItem(); }}
                    placeholder="e.g. Pick up art supplies"
                    className="w-full border-[1.5px] border-[#e8e5e0] rounded-xl py-3 px-3.5 text-[14px] bg-white text-[#2d2926] placeholder:text-[#c8c0b8] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
                    autoFocus
                  />
                </div>

                {/* Child selector */}
                {children.length > 0 && (
                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wide text-[#8B7E74] block mb-1.5">
                      For which child? (optional)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setItemChild("")}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          itemChild === ""
                            ? "bg-[#5c7f63] text-white border-[#5c7f63]"
                            : "bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63]"
                        }`}
                      >
                        Everyone
                      </button>
                      {children.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setItemChild(c.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                          style={
                            itemChild === c.id
                              ? { backgroundColor: c.color || "#5c7f63", color: "white", borderColor: c.color || "#5c7f63" }
                              : { backgroundColor: "white", color: "#7a6f65", borderColor: "#e8e2d9" }
                          }
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Save button */}
                <button
                  type="button"
                  onClick={saveItem}
                  disabled={!itemText.trim() || saving}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#2D5A3D] hover:opacity-90 text-white text-sm font-medium transition-colors disabled:opacity-40"
                >
                  {saving ? "Saving..." : (
                    <>
                      <Send size={14} />
                      Add to {selectedList.name}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
