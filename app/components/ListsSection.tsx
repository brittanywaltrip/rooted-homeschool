"use client";

import { useState, useRef, useCallback } from "react";
import { Plus, Send, Trash2, ChevronDown } from "lucide-react";
import NewListModal from "./NewListModal";
import { useCelebration, CelebrationCheckbox, CelebrationToast } from "./CompletionCelebration";

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
  const { activeId, toast, toastOut, celebrate } = useCelebration();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [itemsByList, setItemsByList] = useState<Record<string, ItemRow[]>>({});
  const [loadingLists, setLoadingLists] = useState<Set<string>>(new Set());
  const [newTextByList, setNewTextByList] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteListId, setDeleteListId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch items for a specific list
  const fetchItems = useCallback(async (listId: string) => {
    const token = await getToken();
    if (!token) return;
    setLoadingLists((prev) => new Set(prev).add(listId));
    try {
      const res = await fetch(`/api/list-items?list_id=${listId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItemsByList((prev) => ({ ...prev, [listId]: data }));
      }
    } catch { /* ignore */ }
    setLoadingLists((prev) => { const next = new Set(prev); next.delete(listId); return next; });
  }, [getToken]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); fetchItems(id); }
      return next;
    });
    setDeleteId(null);
  }

  async function toggleItem(item: ItemRow) {
    if (!item.done) celebrate(item.id);
    // Optimistic update
    setItemsByList((prev) => ({
      ...prev,
      [item.list_id]: (prev[item.list_id] ?? []).map((i) => (i.id === item.id ? { ...i, done: !item.done } : i)),
    }));
    const token = await getToken();
    if (!token) return;
    await fetch("/api/list-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: item.id, done: !item.done }),
    });
    // Re-fetch to get server sort order (done items sink)
    fetchItems(item.list_id);
  }

  async function addItem(listId: string) {
    const text = newTextByList[listId] ?? "";
    if (!text.trim() || adding) return;
    setAdding(true);
    const token = await getToken();
    if (!token) { setAdding(false); return; }
    try {
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ list_id: listId, text: text.trim() }),
      });
      if (res.ok) {
        setNewTextByList((prev) => ({ ...prev, [listId]: "" }));
        fetchItems(listId);
        onListsChanged();
      }
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function deleteItem(itemId: string, listId: string) {
    setItemsByList((prev) => ({ ...prev, [listId]: (prev[listId] ?? []).filter((i) => i.id !== itemId) }));
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

  async function deleteList(listId: string) {
    setDeleteListId(null);
    const token = await getToken();
    if (!token) return;
    await fetch("/api/lists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: listId }),
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
            const isExpanded = expandedIds.has(list.id);
            const listItems = isExpanded ? (itemsByList[list.id] ?? []) : [];
            const doneCount = listItems.filter((i) => i.done).length;
            const totalCount = listItems.length;

            return (
              <div key={list.id}>
                {/* Mini list row */}
                {deleteListId === list.id ? (
                  <div className="flex items-center gap-2 px-4 py-3">
                    <span className="text-sm text-[#2d2926] flex-1">Delete this list and all its items?</span>
                    <button type="button" onClick={() => deleteList(list.id)} className="text-[11px] font-medium text-red-500 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100">Delete</button>
                    <button type="button" onClick={() => setDeleteListId(null)} className="text-[11px] text-[#7a6f65] px-2 py-1">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#faf8f4] transition-colors">
                    <button type="button" onClick={() => toggleExpand(list.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                      <span className="text-lg shrink-0">{list.emoji}</span>
                      <span className="flex-1 text-sm font-medium text-[#2d2926] truncate">{list.name}</span>
                      {isExpanded && totalCount > 0 && (
                        <span className="text-xs font-medium" style={{ color: "var(--g-accent, #5c7f63)" }}>
                          {doneCount}/{totalCount}
                        </span>
                      )}
                    </button>
                    <button type="button" onClick={() => setDeleteListId(list.id)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#d4d0ca] hover:text-red-400 hover:bg-red-50 transition-colors shrink-0">
                      <Trash2 size={13} />
                    </button>
                    <ChevronDown
                      size={14}
                      className="text-[#b5aca4] shrink-0 transition-transform cursor-pointer"
                      style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                      onClick={() => toggleExpand(list.id)}
                    />
                  </div>
                )}

                {/* Expanded items */}
                <div
                  className="overflow-hidden transition-all duration-200 ease-in-out"
                  style={{ maxHeight: isExpanded ? "600px" : "0px", opacity: isExpanded ? 1 : 0 }}
                >
                  {isExpanded && (
                    <div className="px-4 pb-3 pt-0">
                      {loadingLists.has(list.id) ? (
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
                              {activeId === item.id && <CelebrationToast toast={toast} toastOut={toastOut} />}
                              {/* Checkbox */}
                              <CelebrationCheckbox
                                checked={item.done}
                                onToggle={() => toggleItem(item)}
                                itemId={item.id}
                                accentColor="var(--g-brand, #2d5a3d)"
                                celebrating={activeId === item.id}
                              />

                              {/* Text */}
                              <span className={`flex-1 text-[13px] leading-snug transition-all duration-300 ${item.done ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                                {item.text}
                              </span>

                              {/* Delete (shown on long-press) */}
                              {deleteId === item.id && (
                                <button
                                  type="button"
                                  onClick={() => deleteItem(item.id, list.id)}
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
                          type="text"
                          placeholder="Add item..."
                          value={newTextByList[list.id] ?? ""}
                          onChange={(e) => setNewTextByList((prev) => ({ ...prev, [list.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") addItem(list.id); }}
                          className="flex-1 text-[13px] bg-transparent placeholder:text-[#c8c0b8] focus:outline-none text-[#2d2926] py-1"
                        />
                        <button
                          type="button"
                          onClick={() => addItem(list.id)}
                          disabled={!(newTextByList[list.id] ?? "").trim() || adding}
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
