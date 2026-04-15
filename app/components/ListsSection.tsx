"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Send, Trash2, ChevronDown } from "lucide-react";
import NewListModal from "./NewListModal";

// ─── Types ───────────────────────────────────────────────────────────────────

type ListRow = { id: string; name: string; emoji: string; sort_order: number; archived: boolean; created_at: string };
type ItemRow = { id: string; list_id: string; text: string; done: boolean; sort_order: number; child_id: string | null; created_at: string };

interface Props {
  lists: ListRow[];
  onListsChanged: () => void;
  getToken: () => Promise<string | null>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ListsSection({ lists, onListsChanged, getToken }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch items when a list is expanded
  const fetchItems = useCallback(async (listId: string) => {
    const token = await getToken();
    if (!token) return;
    setLoadingItems(true);
    try {
      const res = await fetch(`/api/list-items?list_id=${listId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setItems(await res.json());
    } catch { /* ignore */ }
    setLoadingItems(false);
  }, [getToken]);

  useEffect(() => {
    if (expandedId) fetchItems(expandedId);
    else setItems([]);
  }, [expandedId, fetchItems]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
    setNewText("");
    setDeleteId(null);
  }

  async function toggleItem(item: ItemRow) {
    // Optimistic update
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !item.done } : i)));
    const token = await getToken();
    if (!token) return;
    await fetch("/api/list-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: item.id, done: !item.done }),
    });
    // Re-fetch to get server sort order (done items sink)
    if (expandedId) fetchItems(expandedId);
  }

  async function addItem() {
    if (!newText.trim() || !expandedId || adding) return;
    setAdding(true);
    const token = await getToken();
    if (!token) { setAdding(false); return; }
    try {
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ list_id: expandedId, text: newText.trim() }),
      });
      if (res.ok) {
        setNewText("");
        fetchItems(expandedId);
        onListsChanged();
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function deleteItem(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setDeleteId(null);
    const token = await getToken();
    if (!token) return;
    await fetch("/api/list-items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: itemId }),
    });
    onListsChanged();
  }

  function handleLongPressStart(itemId: string) {
    longPressTimer.current = setTimeout(() => setDeleteId(itemId), 500);
  }

  function handleLongPressEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function handleCreated() {
    setShowModal(false);
    onListsChanged();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (lists.length === 0) return null;

  return (
    <>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-2 px-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">My Lists</p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#5c7f63] hover:bg-[#e8f0e9] transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Lists */}
        <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
          {lists.map((list) => {
            const isExpanded = expandedId === list.id;
            const listItems = isExpanded ? items : [];
            const doneCount = listItems.filter((i) => i.done).length;
            const totalCount = listItems.length;

            return (
              <div key={list.id}>
                {/* Mini list row */}
                <button
                  type="button"
                  onClick={() => toggleExpand(list.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#faf8f4] transition-colors"
                >
                  <span className="text-lg shrink-0">{list.emoji}</span>
                  <span className="flex-1 text-sm font-medium text-[#2d2926] truncate">{list.name}</span>
                  {isExpanded && totalCount > 0 && (
                    <span className="text-xs font-medium" style={{ color: "var(--g-accent, #5c7f63)" }}>
                      {doneCount}/{totalCount}
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className="text-[#b5aca4] shrink-0 transition-transform"
                    style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {/* Expanded items */}
                <div
                  className="overflow-hidden transition-all duration-200 ease-in-out"
                  style={{ maxHeight: isExpanded ? "600px" : "0px", opacity: isExpanded ? 1 : 0 }}
                >
                  {isExpanded && (
                    <div className="px-4 pb-3 pt-0">
                      {loadingItems ? (
                        <p className="text-xs text-[#b5aca4] py-2 text-center">Loading...</p>
                      ) : listItems.length === 0 ? (
                        <p className="text-xs text-[#b5aca4] py-2 text-center">Tap + to add your first item</p>
                      ) : (
                        <div className="space-y-0.5">
                          {listItems.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2.5 py-1.5 group relative"
                              onPointerDown={() => handleLongPressStart(item.id)}
                              onPointerUp={handleLongPressEnd}
                              onPointerLeave={handleLongPressEnd}
                            >
                              {/* Checkbox */}
                              <button
                                type="button"
                                onClick={() => toggleItem(item)}
                                className="w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all"
                                style={{
                                  borderColor: item.done ? "var(--g-brand, #2d5a3d)" : "#d4d0ca",
                                  backgroundColor: item.done ? "var(--g-brand, #2d5a3d)" : "transparent",
                                }}
                              >
                                {item.done && (
                                  <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none">
                                    <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>

                              {/* Text */}
                              <span className={`flex-1 text-[13px] leading-snug ${item.done ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                                {item.text}
                              </span>

                              {/* Delete (shown on long-press) */}
                              {deleteId === item.id && (
                                <button
                                  type="button"
                                  onClick={() => deleteItem(item.id)}
                                  className="shrink-0 w-7 h-7 rounded-full bg-red-50 flex items-center justify-center text-red-400 hover:bg-red-100 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add item input */}
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#f0ede8]">
                        <input
                          ref={inputRef}
                          type="text"
                          placeholder="Add item..."
                          value={newText}
                          onChange={(e) => setNewText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
                          className="flex-1 text-[13px] bg-transparent placeholder:text-[#c8c0b8] focus:outline-none text-[#2d2926] py-1"
                        />
                        <button
                          type="button"
                          onClick={addItem}
                          disabled={!newText.trim() || adding}
                          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                          style={{ color: "var(--g-brand, #2d5a3d)" }}
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New list modal */}
      {showModal && (
        <NewListModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
          getToken={getToken}
        />
      )}
    </>
  );
}
