"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Send, Trash2, ChevronDown, RotateCcw } from "lucide-react";
import NewListModal from "./NewListModal";
import { useCelebration, CelebrationCheckbox, CelebrationToast } from "./CompletionCelebration";

// ─── Types ───────────────────────────────────────────────────────────────────

type ListRow = { id: string; name: string; emoji: string; sort_order: number; archived: boolean; archived_at?: string | null; created_at: string };
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

  // Undo toast state
  const [undoToast, setUndoToast] = useState<{ listId: string; name: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recently deleted
  const [showDeleted, setShowDeleted] = useState(false);
  const [archivedLists, setArchivedLists] = useState<ListRow[]>([]);
  const [permDeleteId, setPermDeleteId] = useState<string | null>(null);
  const [permDeleteAll, setPermDeleteAll] = useState(false);

  const fetchArchived = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/lists?archived=true", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setArchivedLists(await res.json());
    } catch { /* ignore */ }
  }, [getToken]);

  useEffect(() => { fetchArchived(); }, [fetchArchived]);

  // Fetch items for a specific list
  const fetchItems = useCallback(async (listId: string) => {
    const token = await getToken();
    if (!token) return;
    setLoadingLists((prev) => new Set(prev).add(listId));
    try {
      const res = await fetch(`/api/list-items?list_id=${listId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const data = await res.json(); setItemsByList((prev) => ({ ...prev, [listId]: data })); }
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

  async function softDeleteList(listId: string) {
    const list = lists.find((l) => l.id === listId);
    setDeleteListId(null);
    const token = await getToken();
    if (!token) return;
    await fetch("/api/lists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: listId }),
    });
    onListsChanged();
    fetchArchived();
    // Show undo toast
    if (list) {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoToast({ listId, name: list.name });
      undoTimer.current = setTimeout(() => setUndoToast(null), 5000);
    }
  }

  async function undoDelete() {
    if (!undoToast) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const token = await getToken();
    if (!token) { setUndoToast(null); return; }
    await fetch("/api/lists", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: undoToast.listId, archived: false }),
    });
    setUndoToast(null);
    onListsChanged();
    fetchArchived();
  }

  async function restoreList(listId: string) {
    const token = await getToken();
    if (!token) return;
    await fetch("/api/lists", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: listId, archived: false }),
    });
    onListsChanged();
    fetchArchived();
  }

  async function permanentDeleteList(listId: string) {
    setPermDeleteId(null);
    const token = await getToken();
    if (!token) return;
    await fetch("/api/lists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: listId, permanent: true }),
    });
    fetchArchived();
  }

  async function permanentDeleteAll() {
    setPermDeleteAll(false);
    const token = await getToken();
    if (!token) return;
    for (const a of archivedLists) {
      await fetch("/api/lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: a.id, permanent: true }),
      });
    }
    fetchArchived();
  }

  function handleLongPressStart(itemId: string) { longPressTimer.current = setTimeout(() => setDeleteId(itemId), 500); }
  function handleLongPressEnd() { if (longPressTimer.current) clearTimeout(longPressTimer.current); }
  function handleCreated() { setShowModal(false); onListsChanged(); }

  function daysLeft(archivedAt: string | null): number {
    if (!archivedAt) return 30;
    const d = new Date(archivedAt);
    d.setDate(d.getDate() + 30);
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (lists.length === 0 && archivedLists.length === 0) return null;

  return (
    <>
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-2 px-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8B7E74]">My Lists</p>
          <button type="button" onClick={() => setShowModal(true)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#5c7f63] hover:bg-[#e8f0e9] transition-colors">
            <Plus size={16} />
          </button>
        </div>

        {/* Active lists */}
        {lists.length > 0 && (
          <div className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {lists.map((list) => {
              const isExpanded = expandedIds.has(list.id);
              const listItems = isExpanded ? (itemsByList[list.id] ?? []) : [];
              const doneCount = listItems.filter((i) => i.done).length;
              const totalCount = listItems.length;

              return (
                <div key={list.id}>
                  {deleteListId === list.id ? (
                    <div className="flex items-center gap-2 px-4 py-3">
                      <span className="text-sm text-[#2d2926] flex-1">Delete this list?</span>
                      <button type="button" onClick={() => softDeleteList(list.id)} className="text-[11px] font-medium text-red-500 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100">Delete</button>
                      <button type="button" onClick={() => setDeleteListId(null)} className="text-[11px] text-[#7a6f65] px-2 py-1">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-[#faf8f4] transition-colors">
                      <button type="button" onClick={() => toggleExpand(list.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <span className="text-lg shrink-0">{list.emoji}</span>
                        <span className="flex-1 text-sm font-medium text-[#2d2926] truncate">{list.name}</span>
                        {isExpanded && totalCount > 0 && (
                          <span className="text-xs font-medium" style={{ color: "var(--g-accent, #5c7f63)" }}>{doneCount}/{totalCount}</span>
                        )}
                      </button>
                      <button type="button" onClick={() => setDeleteListId(list.id)} className="w-7 h-7 rounded-full flex items-center justify-center text-[#d4d0ca] hover:text-red-400 hover:bg-red-50 transition-colors shrink-0">
                        <Trash2 size={13} />
                      </button>
                      <ChevronDown size={14} className="text-[#b5aca4] shrink-0 transition-transform cursor-pointer"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                        onClick={() => toggleExpand(list.id)} />
                    </div>
                  )}

                  {/* Expanded items */}
                  <div className="overflow-hidden transition-all duration-200 ease-in-out"
                    style={{ maxHeight: isExpanded ? "600px" : "0px", opacity: isExpanded ? 1 : 0 }}>
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-0">
                        {loadingLists.has(list.id) ? (
                          <p className="text-xs text-[#b5aca4] py-2 text-center">Loading...</p>
                        ) : listItems.length === 0 ? (
                          <p className="text-xs text-[#b5aca4] py-2 text-center">Tap + to add your first item</p>
                        ) : (
                          <div className="space-y-0.5">
                            {listItems.map((item) => (
                              <div key={item.id} className="flex items-center gap-2.5 py-1.5 group relative"
                                onPointerDown={() => handleLongPressStart(item.id)}
                                onPointerUp={handleLongPressEnd} onPointerLeave={handleLongPressEnd}>
                                {activeId === item.id && <CelebrationToast toast={toast} toastOut={toastOut} />}
                                <CelebrationCheckbox checked={item.done} onToggle={() => toggleItem(item)}
                                  itemId={item.id} accentColor="var(--g-brand, #2d5a3d)" celebrating={activeId === item.id} />
                                <span className={`flex-1 text-[13px] leading-snug transition-all duration-300 ${item.done ? "line-through text-[#b5aca4]" : "text-[#2d2926]"}`}>
                                  {item.text}
                                </span>
                                {deleteId === item.id && (
                                  <button type="button" onClick={() => deleteItem(item.id, list.id)}
                                    className="shrink-0 w-7 h-7 rounded-full bg-red-50 flex items-center justify-center text-red-400 hover:bg-red-100 transition-colors">
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#f0ede8]">
                          <input type="text" placeholder="Add item..."
                            value={newTextByList[list.id] ?? ""}
                            onChange={(e) => setNewTextByList((prev) => ({ ...prev, [list.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") addItem(list.id); }}
                            className="flex-1 text-[13px] bg-transparent placeholder:text-[#c8c0b8] focus:outline-none text-[#2d2926] py-1" />
                          <button type="button" onClick={() => addItem(list.id)}
                            disabled={!(newTextByList[list.id] ?? "").trim() || adding}
                            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                            style={{ color: "var(--g-brand, #2d5a3d)" }}>
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
        )}

        {/* Undo toast */}
        {undoToast && (
          <div className="flex items-center justify-between bg-[#2d2926] rounded-full px-4 py-2 mt-2">
            <span className="text-sm text-white">List deleted</span>
            <button type="button" onClick={undoDelete} className="text-sm font-medium text-[#5c7f63] ml-3">Undo</button>
          </div>
        )}

        {/* Recently deleted */}
        {archivedLists.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setShowDeleted(!showDeleted)}
              className="text-[11px] text-[#b5aca4] hover:text-[#7a6f65] transition-colors flex items-center gap-1 px-0.5">
              🗑️ Recently deleted ({archivedLists.length})
              <ChevronDown size={12} className="transition-transform" style={{ transform: showDeleted ? "rotate(180deg)" : "rotate(0deg)" }} />
            </button>

            <div className="overflow-hidden transition-all duration-200 ease-in-out"
              style={{ maxHeight: showDeleted ? "600px" : "0px", opacity: showDeleted ? 1 : 0 }}>
              {showDeleted && (
                <div className="mt-2 bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
                  {archivedLists.length >= 2 && (
                    <div className="px-4 py-2 flex items-center justify-between">
                      {permDeleteAll ? (
                        <>
                          <span className="text-[11px] text-[#2d2926]">Delete all permanently?</span>
                          <div className="flex gap-1">
                            <button type="button" onClick={permanentDeleteAll} className="text-[11px] font-medium text-red-500 px-2 py-0.5 rounded bg-red-50">Delete</button>
                            <button type="button" onClick={() => setPermDeleteAll(false)} className="text-[11px] text-[#7a6f65] px-2 py-0.5">Cancel</button>
                          </div>
                        </>
                      ) : (
                        <button type="button" onClick={() => setPermDeleteAll(true)} className="text-[11px] text-red-400 hover:text-red-500">
                          Delete all permanently
                        </button>
                      )}
                    </div>
                  )}
                  {archivedLists.map((a) => (
                    <div key={a.id} className="px-4 py-2.5">
                      {permDeleteId === a.id ? (
                        <div>
                          <p className="text-[11px] text-[#2d2926] mb-1.5">Permanently delete? This can&apos;t be undone.</p>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => permanentDeleteList(a.id)} className="text-[11px] font-medium text-red-500 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100">Delete</button>
                            <button type="button" onClick={() => setPermDeleteId(null)} className="text-[11px] text-[#7a6f65] px-2 py-1">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-base">{a.emoji}</span>
                          <span className="text-sm text-[#7a6f65] flex-1 truncate">{a.name}</span>
                          <span className="text-[10px] text-[#b5aca4] shrink-0">{daysLeft(a.archived_at ?? null)}d left</span>
                          <button type="button" onClick={() => restoreList(a.id)} className="text-[11px] font-medium text-[#5c7f63] px-2 py-0.5">Restore</button>
                          <button type="button" onClick={() => setPermDeleteId(a.id)} className="text-[11px] font-medium text-red-400 px-2 py-0.5">Delete forever</button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="px-4 py-2">
                    <p className="text-[10px] text-[#b5aca4]">Lists are automatically deleted after 30 days</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <NewListModal onClose={() => setShowModal(false)} onCreated={handleCreated} getToken={getToken} />
      )}
    </>
  );
}
