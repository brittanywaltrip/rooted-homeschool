"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2, Check, X, Plus, ChevronDown, ChevronUp, ExternalLink, ArrowLeft, Eye, EyeOff } from "lucide-react";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

const CATEGORIES = [
  { id: "discounts",    label: "💰 Discounts"    },
  { id: "field_trips",  label: "🌍 Field Trips"  },
  { id: "printables",   label: "🖨️ Printables"  },
  { id: "science",      label: "🔬 Science"      },
  { id: "weekly_picks", label: "⭐ Free Picks"   },
  { id: "easy_win",     label: "⚡ Easy Wins"    },
] as const;

type CategoryId = typeof CATEGORIES[number]["id"];

const GRADE_OPTIONS = ["All Ages", "K–2", "3–5", "6–8", "9–12"];

type Resource = {
  id: string;
  category: CategoryId;
  title: string;
  description: string;
  url: string;
  grade_level: string;
  badge_text: string;
  active: boolean;
  sort_order: number;
};

type EditState = Partial<Resource>;

const EMPTY_RESOURCE = (category: CategoryId): Omit<Resource, "id"> => ({
  category,
  title: "",
  description: "",
  url: "",
  grade_level: "All Ages",
  badge_text: "",
  active: true,
  sort_order: 0,
});

function TextInput({ label, value, onChange, placeholder, multiline }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean;
}) {
  const cls = "w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/30";
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-1">{label}</label>
      {multiline ? (
        <textarea rows={3} className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input type="text" className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

function ResourceForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: EditState;
  onSave: (data: EditState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<EditState>(initial);
  const set = (key: keyof EditState) => (val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-3 bg-[#f8f7f4] border border-[#e8e2d9] rounded-xl p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput label="Title *" value={form.title ?? ""} onChange={set("title")} placeholder="Resource name" />
        <TextInput label="Badge text" value={form.badge_text ?? ""} onChange={set("badge_text")} placeholder="e.g. 15% off" />
      </div>
      <TextInput label="Description" value={form.description ?? ""} onChange={set("description")} placeholder="Short description" multiline />
      <TextInput label="URL" value={form.url ?? ""} onChange={set("url")} placeholder="https://…" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-1">Grade Level</label>
          <select
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#e8e2d9] bg-white focus:outline-none focus:border-[#5c7f63]"
            value={form.grade_level ?? "All Ages"}
            onChange={(e) => set("grade_level")(e.target.value)}
          >
            {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active ?? true}
              onChange={(e) => set("active")(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm text-[#2d2926] font-medium">Active (visible)</span>
          </label>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.title?.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#5c7f63] text-white text-sm font-medium rounded-lg hover:bg-[#3d5c42] disabled:opacity-50 transition-colors"
        >
          <Check size={14} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] text-sm font-medium rounded-lg hover:bg-[#f0ede8] transition-colors"
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResourceRow({
  resource,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  resource: Resource;
  onEdit: (r: Resource) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={`bg-[#fefcf9] border rounded-xl p-4 transition-opacity ${resource.active ? "border-[#e8e2d9]" : "border-[#e8e2d9] opacity-60"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-semibold text-sm text-[#2d2926]">{resource.title}</span>
            {resource.badge_text && (
              <span className="text-[10px] font-bold bg-[#e8f0e9] text-[#3d5c42] px-2 py-0.5 rounded-full">
                {resource.badge_text}
              </span>
            )}
            <span className="text-[10px] bg-[#f5ede0] text-[#8b6f47] px-2 py-0.5 rounded-full">
              {resource.grade_level}
            </span>
            {!resource.active && (
              <span className="text-[10px] bg-red-50 text-red-500 px-2 py-0.5 rounded-full">Hidden</span>
            )}
          </div>
          {resource.description && (
            <p className="text-xs text-[#7a6f65] leading-relaxed line-clamp-2 mb-1">{resource.description}</p>
          )}
          {resource.url && (
            <a
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-[#5c7f63] hover:underline"
            >
              <ExternalLink size={10} />
              {resource.url.length > 50 ? resource.url.slice(0, 50) + "…" : resource.url}
            </a>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onToggleActive(resource.id, !resource.active)}
            title={resource.active ? "Hide resource" : "Show resource"}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#b5aca4] hover:text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
          >
            {resource.active ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={() => onEdit(resource)}
            title="Edit"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#b5aca4] hover:text-[#5c7f63] hover:bg-[#e8f0e9] transition-colors"
          >
            <Pencil size={14} />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDelete(resource.id)}
                className="text-[10px] bg-red-500 text-white px-2 py-1 rounded-lg hover:bg-red-600 font-medium"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-[#7a6f65] px-2 py-1 rounded-lg hover:bg-[#f0ede8]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#b5aca4] hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminResourcesPage() {
  const router = useRouter();
  const [checking,   setChecking]   = useState(true);
  const [resources,  setResources]  = useState<Resource[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [addingCat,  setAddingCat]  = useState<CategoryId | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState<string | null>(null);
  const [collapsed,  setCollapsed]  = useState<Record<string, boolean>>({});

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // Auth check — wait for session rehydration on mobile
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (!session || !ADMIN_EMAILS.includes(session.user.email ?? '')) {
          router.replace('/dashboard');
          return;
        }
        // Refresh the session to get a fresh access token
        await supabase.auth.refreshSession();
        setChecking(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // Load resources
  const loadResources = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("resources")
      .select("id, category, title, description, url, grade_level, badge_text, active, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error && data) setResources(data as Resource[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!checking) loadResources();
  }, [checking, loadResources]);

  // Save edit
  async function handleSaveEdit(id: string, form: EditState) {
    setSaving(true);
    const { error } = await supabase
      .from("resources")
      .update({
        title:       form.title?.trim(),
        description: form.description?.trim() ?? "",
        url:         form.url?.trim() ?? "",
        grade_level: form.grade_level ?? "All Ages",
        badge_text:  form.badge_text?.trim() ?? "",
        active:      form.active ?? true,
      })
      .eq("id", id);
    setSaving(false);
    if (error) { showToast("❌ Save failed: " + error.message); return; }
    showToast("✅ Resource updated");
    setEditingId(null);
    loadResources();
  }

  // Add new
  async function handleAdd(category: CategoryId, form: EditState) {
    if (!form.title?.trim()) return;
    setSaving(true);
    const maxOrder = resources
      .filter((r) => r.category === category)
      .reduce((max, r) => Math.max(max, r.sort_order), 0);
    const { error } = await supabase.from("resources").insert({
      category,
      title:       form.title.trim(),
      description: form.description?.trim() ?? "",
      url:         form.url?.trim() ?? "",
      grade_level: form.grade_level ?? "All Ages",
      badge_text:  form.badge_text?.trim() ?? "",
      active:      form.active ?? true,
      sort_order:  maxOrder + 1,
    });
    setSaving(false);
    if (error) { showToast("❌ Add failed: " + error.message); return; }
    showToast("✅ Resource added");
    setAddingCat(null);
    loadResources();
  }

  // Delete
  async function handleDelete(id: string) {
    const { error } = await supabase.from("resources").delete().eq("id", id);
    if (error) { showToast("❌ Delete failed: " + error.message); return; }
    showToast("🗑️ Resource deleted");
    setResources((prev) => prev.filter((r) => r.id !== id));
  }

  // Toggle active
  async function handleToggleActive(id: string, active: boolean) {
    const { error } = await supabase.from("resources").update({ active }).eq("id", id);
    if (error) { showToast("❌ Update failed"); return; }
    setResources((prev) => prev.map((r) => r.id === id ? { ...r, active } : r));
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f8f7f4] flex items-center justify-center">
        <span className="text-3xl animate-pulse">🌿</span>
      </div>
    );
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = resources.filter((r) => r.category === cat.id);
    return acc;
  }, {} as Record<CategoryId, Resource[]>);

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#2d2926] text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 text-xs text-[#7a6f65] hover:text-[#3d5c42] transition-colors"
            >
              <ArrowLeft size={13} />
              Back to admin
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-[#2d2926]">Resources Admin ⚙️</h1>
          <p className="text-sm text-[#7a6f65] mt-1">
            Manage all resource links shown to users. Changes go live immediately.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs bg-[#e8f0e9] text-[#3d5c42] px-2.5 py-1 rounded-full font-medium">
              {resources.length} total resources
            </span>
            <span className="text-xs bg-[#f5ede0] text-[#8b6f47] px-2.5 py-1 rounded-full font-medium">
              {resources.filter((r) => !r.active).length} hidden
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <span className="text-3xl animate-pulse">📚</span>
          </div>
        ) : (
          CATEGORIES.map((cat) => {
            const catResources = grouped[cat.id];
            const isCollapsed = collapsed[cat.id];
            return (
              <section key={cat.id} className="space-y-3">
                {/* Category header */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setCollapsed((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    <h2 className="text-base font-bold text-[#2d2926]">{cat.label}</h2>
                    <span className="text-xs text-[#b5aca4]">({catResources.length})</span>
                    {isCollapsed ? <ChevronDown size={16} className="text-[#b5aca4] ml-auto" /> : <ChevronUp size={16} className="text-[#b5aca4] ml-auto" />}
                  </button>
                </div>

                {!isCollapsed && (
                  <>
                    {catResources.length === 0 && (
                      <p className="text-sm text-[#b5aca4] py-4 text-center">No resources yet.</p>
                    )}

                    {catResources.map((resource) =>
                      editingId === resource.id ? (
                        <ResourceForm
                          key={resource.id}
                          initial={resource}
                          onSave={(form) => handleSaveEdit(resource.id, form)}
                          onCancel={() => setEditingId(null)}
                          saving={saving}
                        />
                      ) : (
                        <ResourceRow
                          key={resource.id}
                          resource={resource}
                          onEdit={(r) => { setEditingId(r.id); setAddingCat(null); }}
                          onDelete={handleDelete}
                          onToggleActive={handleToggleActive}
                        />
                      )
                    )}

                    {/* Add new */}
                    {addingCat === cat.id ? (
                      <ResourceForm
                        initial={EMPTY_RESOURCE(cat.id)}
                        onSave={(form) => handleAdd(cat.id, form)}
                        onCancel={() => setAddingCat(null)}
                        saving={saving}
                      />
                    ) : (
                      <button
                        onClick={() => { setAddingCat(cat.id); setEditingId(null); }}
                        className="flex items-center gap-2 w-full px-4 py-3 border border-dashed border-[#c8bfb5] rounded-xl text-sm text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#3d5c42] hover:bg-[#f0f4f0] transition-colors"
                      >
                        <Plus size={15} />
                        Add {cat.label.split(" ").slice(1).join(" ")} resource
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
