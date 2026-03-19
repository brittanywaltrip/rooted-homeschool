"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Pencil, Trash2, Check, X, Plus, GripVertical, Users, Camera, GraduationCap, ExternalLink, Sprout } from "lucide-react";
import { supabase } from "@/lib/supabase";

function getCurrentSchoolYearLabel(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}–${startYear + 1}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number | null;
  archived: boolean;
  graduated_at: string | null;
};

// ─── Color palette ────────────────────────────────────────────────────────────

const COLORS = [
  { label: "Green",  value: "#5c7f63" },
  { label: "Sage",   value: "#7a9e7e" },
  { label: "Blue",   value: "#4a7a8a" },
  { label: "Indigo", value: "#5a5c8a" },
  { label: "Purple", value: "#7a5c8a" },
  { label: "Orange", value: "#c4956a" },
  { label: "Pink",   value: "#c4697a" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ColorPicker({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={c.label}
          onClick={() => onChange(c.value)}
          className="w-7 h-7 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#5c7f63]"
          style={{
            backgroundColor: c.value,
            borderColor: selected === c.value ? "#2d2926" : "transparent",
          }}
        >
          {selected === c.value && (
            <Check size={12} className="text-white" strokeWidth={3} />
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // Family name
  const [familyName,   setFamilyName]   = useState("");
  const [savingFamily, setSavingFamily] = useState(false);
  const [savedFamily,  setSavedFamily]  = useState(false);
  const [userEmail,    setUserEmail]    = useState("");

  // Children list
  const [children,        setChildren]        = useState<Child[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);

  // Add child form
  const [newName,    setNewName]    = useState("");
  const [newColor,   setNewColor]   = useState(COLORS[0].value);
  const [addingChild, setAddingChild] = useState(false);
  const [addError,   setAddError]   = useState("");

  // Inline edit state
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editName,     setEditName]     = useState("");
  const [editColor,    setEditColor]    = useState("");
  const [savingEdit,   setSavingEdit]   = useState(false);

  // Delete confirm
  const [deleteId,     setDeleteId]     = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  // Graduation
  const [graduatingId, setGraduatingId] = useState<string | null>(null);

  // Family photo
  const [familyPhotoUrl,  setFamilyPhotoUrl]  = useState<string | null>(null);
  const [photoUploading,  setPhotoUploading]  = useState(false);
  const [photoError,      setPhotoError]      = useState<string | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  // Homeschool state
  const [homeschoolState,  setHomeschoolState]  = useState("");
  const [savingState,      setSavingState]      = useState(false);
  const [savedState,       setSavedState]       = useState(false);

  // Partner access
  const [partnerEmail,      setPartnerEmail]      = useState("");
  const [savedPartnerEmail, setSavedPartnerEmail] = useState("");
  const [savingPartner,     setSavingPartner]     = useState(false);
  const [partnerSaved,      setPartnerSaved]      = useState(false);
  const [partnerError,      setPartnerError]      = useState("");

  // Subscription
  const [isPro,               setIsPro]               = useState(false);
  const [planType,            setPlanType]            = useState<string | null>(null);
  const [currentPeriodEnd,    setCurrentPeriodEnd]    = useState<string | null>(null);
  const [subscriptionStatus,  setSubscriptionStatus]  = useState<string | null>(null);
  const [portalLoading,       setPortalLoading]       = useState(false);

  // School year transition
  const [showYearModal,    setShowYearModal]    = useState(false);
  const [yearTransitioning, setYearTransitioning] = useState(false);
  const [yearError,        setYearError]        = useState("");
  const [yearSuccessToast, setYearSuccessToast] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUserEmail(user.email ?? "");

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, partner_email, family_photo_url, state, is_pro, plan_type, current_period_end, subscription_status")
      .eq("id", user.id)
      .maybeSingle();

    setFamilyName(
      profile?.display_name ?? user.user_metadata?.family_name ?? ""
    );
    const pe = (profile as { display_name?: string; partner_email?: string; family_photo_url?: string; state?: string } | null)?.partner_email ?? "";
    setPartnerEmail(pe);
    setSavedPartnerEmail(pe);
    setFamilyPhotoUrl((profile as { family_photo_url?: string } | null)?.family_photo_url ?? null);
    setHomeschoolState((profile as { state?: string } | null)?.state ?? "");
    setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
    setPlanType((profile as { plan_type?: string } | null)?.plan_type ?? null);
    setCurrentPeriodEnd((profile as { current_period_end?: string } | null)?.current_period_end ?? null);
    setSubscriptionStatus((profile as { subscription_status?: string } | null)?.subscription_status ?? null);

    const { data: kids } = await supabase
      .from("children")
      .select("id, name, color, sort_order, archived, graduated_at")
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("sort_order");

    setChildren(kids ?? []);
    setLoadingChildren(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Family name ───────────────────────────────────────────────────────────

  async function saveFamilyName() {
    setSavingFamily(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) { setSavingFamily(false); return; }

    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ display_name: familyName.trim() }),
    });

    setSavingFamily(false);
    setSavedFamily(true);
    setTimeout(() => setSavedFamily(false), 2500);
  }

  // ── Homeschool state ──────────────────────────────────────────────────────

  async function saveHomeschoolState() {
    setSavingState(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingState(false); return; }
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ state: homeschoolState || null }),
    });
    setSavingState(false);
    setSavedState(true);
    setTimeout(() => setSavedState(false), 2500);
  }

  // ── Family photo ──────────────────────────────────────────────────────────

  async function uploadFamilyPhoto(file: File) {
    setPhotoUploading(true);
    setPhotoError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPhotoUploading(false); return; }

    const ext  = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/family.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("family-photos")
      .upload(path, file, { contentType: file.type, upsert: true });

    if (uploadErr) {
      setPhotoError(
        uploadErr.message.includes("Bucket not found")
          ? "Create a public storage bucket named 'family-photos' in Supabase first."
          : `Upload failed: ${uploadErr.message}`
      );
      setPhotoUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("family-photos").getPublicUrl(path);
    const url = urlData.publicUrl;

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/profile/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ family_photo_url: url }),
    });

    if (!res.ok) {
      const { error } = await res.json();
      setPhotoError(`Saved photo but couldn't update profile: ${error}`);
      setPhotoUploading(false);
      return;
    }

    // Cache-bust so re-uploads to the same path always show the new image
    setFamilyPhotoUrl(`${url}?t=${Date.now()}`);
    setPhotoUploading(false);
  }

  // ── Add child ─────────────────────────────────────────────────────────────

  async function addChild(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAddError("");
    setAddingChild(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const maxOrder = children.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
    const nameKey  = newName.trim().toLowerCase().replace(/\s+/g, "_");

    const { data, error } = await supabase
      .from("children")
      .insert({
        user_id:    user.id,
        name:       newName.trim(),
        color:      newColor,
        archived:   false,
        sort_order: maxOrder + 1,
        name_key:   nameKey,
      })
      .select("id, name, color, sort_order, archived, graduated_at")
      .single();

    if (error) {
      setAddError(error.message);
    } else if (data) {
      setChildren((prev) => [...prev, data]);
      setNewName("");
      setNewColor(COLORS[0].value);
    }
    setAddingChild(false);
  }

  // ── Edit child ────────────────────────────────────────────────────────────

  function startEdit(child: Child) {
    setEditingId(child.id);
    setEditName(child.name);
    setEditColor(child.color ?? COLORS[0].value);
    setDeleteId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditColor("");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setSavingEdit(true);

    const { error } = await supabase
      .from("children")
      .update({ name: editName.trim(), color: editColor })
      .eq("id", id);

    if (!error) {
      setChildren((prev) =>
        prev.map((c) => c.id === id ? { ...c, name: editName.trim(), color: editColor } : c)
      );
      setEditingId(null);
    }
    setSavingEdit(false);
  }

  // ── Delete child (soft-archive) ───────────────────────────────────────────

  async function archiveChild(id: string) {
    setDeletingId(id);

    const { error } = await supabase
      .from("children")
      .update({ archived: true })
      .eq("id", id);

    if (!error) {
      setChildren((prev) => prev.filter((c) => c.id !== id));
    }
    setDeletingId(null);
    setDeleteId(null);
  }

  // ── Graduate child ────────────────────────────────────────────────────────

  async function graduateChild(id: string) {
    setGraduatingId(id);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("children")
      .update({ graduated_at: today })
      .eq("id", id);
    if (!error) {
      setChildren((prev) =>
        prev.map((c) => c.id === id ? { ...c, graduated_at: today } : c)
      );
    }
    setGraduatingId(null);
  }

  // ── Partner access ────────────────────────────────────────────────────────

  async function savePartnerEmail() {
    setSavingPartner(true);
    setPartnerError("");
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) { setSavingPartner(false); return; }

    const res = await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ partner_email: partnerEmail.trim() || null }),
    });

    if (!res.ok) {
      const { error } = await res.json();
      setPartnerError(
        (error as string)?.includes("partner_email")
          ? "Column missing. Run this SQL in Supabase: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_email text;"
          : (error as string) ?? "Failed to save. Please try again."
      );
    } else {
      setSavedPartnerEmail(partnerEmail.trim());
      setPartnerSaved(true);
      setTimeout(() => setPartnerSaved(false), 2500);
    }
    setSavingPartner(false);
  }

  // ── Manage subscription ───────────────────────────────────────────────────

  async function handleManageSubscription() {
    setPortalLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPortalLoading(false); return; }
    const res = await fetch('/api/stripe/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    const data = await res.json();
    if (data.error === 'no_customer') {
      setPortalLoading(false);
      alert('To manage your subscription please email hello.rootedapp@gmail.com');
      return;
    }
    window.location.href = data.url;
  }

  // ── New school year ───────────────────────────────────────────────────────

  async function startNewSchoolYear() {
    setYearTransitioning(true);
    setYearError("");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setYearTransitioning(false); return; }

    const res = await fetch("/api/school-year/new", {
      method: "POST",
      headers: { "Authorization": `Bearer ${session.access_token}` },
    });

    if (!res.ok) {
      const { error } = await res.json();
      setYearError(error ?? "Something went wrong. Please try again.");
      setYearTransitioning(false);
      return;
    }

    setYearTransitioning(false);
    setShowYearModal(false);
    setYearSuccessToast(true);
    setTimeout(() => setYearSuccessToast(false), 6000);
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-xl px-5 py-7 space-y-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Manage your account
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Settings ⚙️</h1>
      </div>

      {/* ── Family Name ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Your Family</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
          {/* Email (read-only) */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
              Email address
            </label>
            <p className="text-sm text-[#b5aca4] px-3 py-2.5 bg-[#f8f5f0] rounded-xl border border-[#f0ede8]">
              {userEmail || "—"}
            </p>
          </div>

          {/* Family photo */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-2">
              Family photo
              <span className="text-[#b5aca4] font-normal ml-1">(shown on your shareable updates)</span>
            </label>
            <div className="flex items-center gap-4">
              {/* Current photo or placeholder */}
              <div className="relative shrink-0">
                {familyPhotoUrl ? (
                  <img
                    src={familyPhotoUrl}
                    alt="Family photo"
                    className="w-16 h-16 rounded-full object-cover border-2 border-[#e8e2d9]"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-[#e8f0e9] border-2 border-dashed border-[#c8ddb8] flex items-center justify-center">
                    <Camera size={22} className="text-[#7aaa78]" />
                  </div>
                )}
                {photoUploading && (
                  <div className="absolute inset-0 rounded-full bg-black/30 flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">…</span>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-1.5">
                <button
                  type="button"
                  onClick={() => photoFileRef.current?.click()}
                  disabled={photoUploading}
                  className="px-4 py-2 rounded-xl bg-[#f0ede8] hover:bg-[#e8e2d9] disabled:opacity-50 text-sm font-medium text-[#2d2926] transition-colors"
                >
                  {photoUploading ? "Uploading…" : familyPhotoUrl ? "Change Photo" : "Upload Photo"}
                </button>
                <p className="text-[11px] text-[#b5aca4]">JPG or PNG, square works best</p>
              </div>
            </div>

            <input
              ref={photoFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFamilyPhoto(file);
              }}
            />

            {photoError && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {photoError}
              </p>
            )}
          </div>

          {/* Family name */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
              Family name
              <span className="text-[#b5aca4] font-normal ml-1">
                (shown in your dashboard greeting)
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="e.g. The Waltrip Family"
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
              />
              <button
                onClick={saveFamilyName}
                disabled={savingFamily || !familyName.trim()}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                  savedFamily
                    ? "bg-[#e8f0e9] text-[#3d5c42]"
                    : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                }`}
              >
                {savedFamily ? "✓ Saved" : savingFamily ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {/* Homeschool state */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
              Your state
              <span className="text-[#b5aca4] font-normal ml-1">(for personalized resources)</span>
            </label>
            <div className="flex gap-2">
              <select
                value={homeschoolState}
                onChange={(e) => setHomeschoolState(e.target.value)}
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
              >
                <option value="">Select your state…</option>
                {["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
                  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
                  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
                  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
                  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
                  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
                  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
                  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
                  "Outside the US"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={saveHomeschoolState}
                disabled={savingState}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                  savedState
                    ? "bg-[#e8f0e9] text-[#3d5c42]"
                    : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                }`}
              >
                {savedState ? "✓ Saved" : savingState ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Children ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Children</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
          <span className="text-xs text-[#b5aca4]">
            {children.length} {children.length === 1 ? "child" : "children"}
          </span>
        </div>

        {/* Children list */}
        {loadingChildren ? (
          <div className="text-center py-6">
            <span className="text-xl animate-pulse">🌱</span>
          </div>
        ) : children.length === 0 && editingId === null ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center">
            <p className="text-sm text-[#7a6f65]">
              No children added yet. Add your first child below.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {children.map((child) => (
              <div
                key={child.id}
                className={`bg-[#fefcf9] border rounded-2xl transition-colors ${
                  editingId === child.id
                    ? "border-[#5c7f63] ring-2 ring-[#5c7f63]/15"
                    : deleteId === child.id
                    ? "border-red-200 bg-red-50/30"
                    : "border-[#e8e2d9]"
                }`}
              >
                {editingId === child.id ? (
                  /* ── Edit mode ── */
                  <div className="p-4 space-y-3">
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(child.id); if (e.key === "Escape") cancelEdit(); }}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-2">
                        Color
                      </label>
                      <ColorPicker selected={editColor} onChange={setEditColor} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={cancelEdit}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                      >
                        <X size={14} /> Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(child.id)}
                        disabled={savingEdit || !editName.trim()}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-sm font-medium transition-colors"
                      >
                        <Check size={14} />
                        {savingEdit ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                ) : deleteId === child.id ? (
                  /* ── Delete confirm ── */
                  <div className="p-4">
                    <p className="text-sm font-medium text-[#2d2926] mb-0.5">
                      Remove <span className="text-red-600">{child.name}</span>?
                    </p>
                    <p className="text-xs text-[#7a6f65] mb-3 leading-relaxed">
                      This hides the child from your dashboard. Their lesson history is preserved.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDeleteId(null)}
                        className="flex-1 py-2 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                      >
                        Keep
                      </button>
                      <button
                        onClick={() => archiveChild(child.id)}
                        disabled={deletingId === child.id}
                        className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                      >
                        {deletingId === child.id ? "Removing…" : "Yes, Remove"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Display mode ── */
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <GripVertical size={14} className="text-[#d4cfc9] shrink-0 cursor-grab" />

                    {/* Color dot */}
                    <div
                      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm"
                      style={{ backgroundColor: child.color ?? "#5c7f63" }}
                    >
                      {child.name.charAt(0).toUpperCase()}
                    </div>

                    <span className="flex-1 text-sm font-medium text-[#2d2926]">
                      {child.name}
                    </span>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1">
                      {child.graduated_at ? (
                        <a
                          href={`/dashboard/graduation/${child.id}`}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4e8d4] transition-colors"
                          title="View graduation slideshow"
                        >
                          <GraduationCap size={12} />
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <button
                          onClick={() => graduateChild(child.id)}
                          disabled={graduatingId === child.id}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-[#7a6f65] hover:text-[#5c7f63] hover:bg-[#e8f0e9] disabled:opacity-40 transition-colors"
                          title="Mark as graduated"
                        >
                          <GraduationCap size={12} />
                          <span className="hidden sm:inline">Graduate</span>
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(child)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#b5aca4] hover:text-[#5c7f63] hover:bg-[#e8f0e9] transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { setDeleteId(child.id); setEditingId(null); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#b5aca4] hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Add child form ── */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0ede8]">
            <p className="text-xs font-semibold text-[#7a6f65] uppercase tracking-widest">
              Add a Child
            </p>
          </div>

          <form onSubmit={addChild} className="p-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                Name *
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Emma"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-2">
                Color
              </label>
              <ColorPicker selected={newColor} onChange={setNewColor} />
            </div>

            {/* Preview */}
            {newName.trim() && (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-[#f8f5f0] rounded-xl">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0"
                  style={{ backgroundColor: newColor }}
                >
                  {newName.trim().charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-[#2d2926]">{newName.trim()}</span>
                <span className="text-xs text-[#b5aca4] ml-auto">Preview</span>
              </div>
            )}

            {addError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {addError}
              </p>
            )}

            <button
              type="submit"
              disabled={addingChild || !newName.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white text-sm font-medium py-3 rounded-xl transition-colors"
            >
              <Plus size={16} />
              {addingChild ? "Adding…" : "Add Child"}
            </button>
          </form>
        </div>
      </section>

      {/* ── Partner Access ──────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Partner Access</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
              <Users size={16} className="text-[#5c7f63]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#2d2926] mb-0.5">Invite a Partner</p>
              <p className="text-xs text-[#7a6f65] leading-relaxed">
                Enter your co-parent&apos;s email address. When they sign up or log in with that
                email, they&apos;ll see your family&apos;s dashboard in read-only mode.
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
              Partner email address
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
                placeholder="partner@email.com"
                className="flex-1 px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
              />
              <button
                onClick={savePartnerEmail}
                disabled={savingPartner}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                  partnerSaved
                    ? "bg-[#e8f0e9] text-[#3d5c42]"
                    : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                }`}
              >
                {partnerSaved ? "✓ Saved" : savingPartner ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {partnerError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {partnerError}
            </p>
          )}

          {savedPartnerEmail && !partnerError && (
            <div className="bg-[#e8f0e9] rounded-xl px-3 py-2.5">
              <p className="text-xs text-[#3d5c42] font-medium mb-0.5">Partner invite active</p>
              <p className="text-xs text-[#5c7f63]">
                <span className="font-medium">{savedPartnerEmail}</span> can log in at rootedhomeschoolapp.com
                to view your family&apos;s dashboard in read-only mode.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── School Year ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">School Year</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
              <Sprout size={16} className="text-[#5c7f63]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#2d2926] mb-0.5">Start a New School Year</p>
              <p className="text-xs text-[#7a6f65] leading-relaxed">
                Archive your current curriculum and schedule as School Year {getCurrentSchoolYearLabel()},
                then start fresh with a clean plan. Your garden, memories, and family info stay untouched.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setShowYearModal(true); setYearError(""); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#c8ddb8] bg-[#f0f8f0] hover:bg-[#e4f2e4] text-[#3d5c42] text-sm font-medium transition-colors"
          >
            <span>🌱</span>
            Start New School Year
          </button>
        </div>
      </section>

      {/* ── Subscription ────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Subscription</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#2d2926]">
                {planType === 'founding_family'
                  ? '🌱 Founding Family — $39/yr locked forever'
                  : planType === 'standard'
                  ? '🌿 Standard — $59/yr'
                  : '🪴 Free Plan'}
              </p>
              {currentPeriodEnd && subscriptionStatus === 'active' && (
                <p className="text-xs text-[#7a6f65] mt-1">
                  Next billing:{' '}
                  {new Date(currentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric',
                  })}
                </p>
              )}
              {subscriptionStatus === 'cancelled' && (
                <p className="text-xs text-red-500 mt-1">Subscription cancelled</p>
              )}
            </div>
            {isPro ? (
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="shrink-0 px-4 py-2 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] disabled:opacity-40 transition-colors"
              >
                {portalLoading ? 'Loading…' : 'Manage Subscription'}
              </button>
            ) : (
              <a
                href="/dashboard/pricing"
                className="shrink-0 px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-medium transition-colors"
              >
                Upgrade
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── Danger zone ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Account</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
          <p className="text-xs text-[#7a6f65] leading-relaxed">
            To change your email or password, or to close your account, contact{" "}
            <span className="text-[#5c7f63] font-medium">support@rootedhomeschool.com</span>
          </p>
        </div>
      </section>

      {/* ── Admin (only shown to admin email) ───────────────── */}
      {userEmail === "garfieldbrittany@gmail.com" && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#2d2926]">Admin</h2>
            <span className="h-px flex-1 bg-[#e8e2d9]" />
          </div>
          <a
            href="/admin/resources"
            className="flex items-center justify-between bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 hover:border-[#5c7f63] hover:bg-[#f8fcf8] transition-colors group"
          >
            <div>
              <p className="text-sm font-medium text-[#2d2926]">⚙️ Manage Resources</p>
              <p className="text-xs text-[#7a6f65] mt-0.5">Edit discounts, field trips, printables, and science projects</p>
            </div>
            <span className="text-[#b5aca4] group-hover:text-[#5c7f63] text-lg">→</span>
          </a>
          <a
            href="/admin/dashboard"
            className="flex items-center justify-between bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 hover:border-[#5c7f63] hover:bg-[#f8fcf8] transition-colors group"
          >
            <div>
              <p className="text-sm font-medium text-[#2d2926]">📊 Business Dashboard</p>
              <p className="text-xs text-[#7a6f65] mt-0.5">Users, revenue, costs, and app usage</p>
            </div>
            <span className="text-[#b5aca4] group-hover:text-[#5c7f63] text-lg">→</span>
          </a>
        </section>
      )}

      <div className="h-4" />

      {/* ── New School Year Modal ────────────────────────────── */}
      {showYearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-[#fefcf9] rounded-2xl border border-[#e8e2d9] shadow-xl max-w-sm w-full p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-xl shrink-0">
                🌱
              </div>
              <h2 className="text-lg font-bold text-[#2d2926] leading-snug">
                Ready for a fresh start?
              </h2>
            </div>

            <p className="text-sm text-[#5c5248] leading-relaxed">
              Your current lessons, curriculum goals, and schedule will be archived as{" "}
              <span className="font-semibold text-[#2d2926]">
                School Year {getCurrentSchoolYearLabel()}
              </span>
              . Your garden, memories, children, and family info stay exactly as they are.{" "}
              <span className="font-medium text-[#7a6f65]">This cannot be undone.</span>
            </p>

            {yearError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {yearError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowYearModal(false); setYearError(""); }}
                disabled={yearTransitioning}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={startNewSchoolYear}
                disabled={yearTransitioning}
                className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {yearTransitioning ? "Archiving…" : "Archive & Start Fresh →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success Toast ────────────────────────────────────── */}
      {yearSuccessToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
          <div className="bg-[#2d2926] text-white text-sm rounded-2xl px-5 py-4 shadow-lg flex items-start gap-3">
            <span className="text-lg shrink-0">🌱</span>
            <div>
              <p className="font-semibold mb-0.5">Welcome to your new school year!</p>
              <p className="text-[#b5aca4] text-xs leading-relaxed">
                Add your new curriculum goals to get started.
              </p>
            </div>
            <button
              onClick={() => setYearSuccessToast(false)}
              className="ml-auto shrink-0 text-[#7a6f65] hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
