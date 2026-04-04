"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, Check, X, Plus, GripVertical, Users, Camera, GraduationCap, ExternalLink, Sprout } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/profile-context";

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
  birthday: string | null;
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

type SettingsTab = "family" | "kids" | "account" | "partners";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

type AffiliateRow = { id: string; name: string; code: string; stripe_coupon_id: string; is_active: boolean; created_at: string; user_id: string; clicks: number };

function AffiliateStatCell({ couponId, code, field, prefix = "" }: { couponId: string; code: string; field: "totalRedemptions" | "payingCount" | "revenueDriven"; prefix?: string }) {
  const [val, setVal] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/api/stripe/affiliate-stats?coupon_id=${couponId}&code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(d => setVal(d[field] ?? 0))
      .catch(() => setVal(0));
  }, [couponId, code, field]);
  return <span className="text-[#2d2926] font-medium">{val === null ? "—" : `${prefix}${val}`}</span>;
}

function AffiliateStatsRow({ couponId, code }: { couponId: string; code: string }) {
  const [stats, setStats] = useState<{ totalRedemptions: number; payingCount: number; revenueDriven: number } | null>(null);
  useEffect(() => {
    fetch(`/api/stripe/affiliate-stats?coupon_id=${couponId}&code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, [couponId, code]);
  return (
    <div className="grid grid-cols-3 divide-x divide-[#c7d2fe] bg-white border border-[#c7d2fe] rounded-xl overflow-hidden">
      <div className="px-3 py-3 text-center">
        <p className="text-lg font-bold text-[#2d2926]">{stats?.totalRedemptions ?? '—'}</p>
        <p className="text-[10px] text-[#7a6f65]">Families</p>
      </div>
      <div className="px-3 py-3 text-center">
        <p className="text-lg font-bold text-[#3d5c42]">{stats?.payingCount ?? '—'}</p>
        <p className="text-[10px] text-[#7a6f65]">Paying</p>
      </div>
      <div className="px-3 py-3 text-center">
        <p className="text-lg font-bold text-[#2d2926]">${stats?.revenueDriven ?? '—'}</p>
        <p className="text-[10px] text-[#7a6f65]">Revenue</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { refreshProfile } = useProfile();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    searchParams.get("section") === "children" ? "kids" : "family"
  );

  useEffect(() => { document.title = "Settings \u00b7 Rooted"; }, []);

  // First / Last name
  const [firstName,      setFirstName]      = useState("");
  const [editingFirst,   setEditingFirst]   = useState(false);
  const [savingFirst,    setSavingFirst]    = useState(false);
  const [savedFirst,     setSavedFirst]     = useState(false);
  const [lastName,       setLastName]       = useState("");
  const [editingLast,    setEditingLast]    = useState(false);
  const [savingLast,     setSavingLast]     = useState(false);
  const [savedLast,      setSavedLast]      = useState(false);

  // Family name
  const [familyName,   setFamilyName]   = useState("");
  const [editingName,  setEditingName]  = useState(false);
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
  const [editError,    setEditError]    = useState("");

  // Delete confirm
  const [deleteId,     setDeleteId]     = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);

  // Graduation

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

  // Password reset
  const [resetSending,    setResetSending]    = useState(false);
  const [resetSent,       setResetSent]       = useState(false);
  const [resetError,      setResetError]      = useState("");

  // Close account
  const [showDeleteModal,  setShowDeleteModal]  = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount,  setDeletingAccount]  = useState(false);
  const [deleteError,      setDeleteError]      = useState("");

  // Affiliate / Ambassador
  const [affiliateData, setAffiliateData] = useState<{ code: string; stripe_coupon_id: string; is_active: boolean; created_at: string; clicks: number } | null>(null);
  const [affiliateStats, setAffiliateStats] = useState<{ totalRedemptions: number; payingCount: number; revenueDriven: number } | null>(null);
  const [copiedToast, setCopiedToast] = useState<string | false>(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allAffiliates, setAllAffiliates] = useState<AffiliateRow[]>([]);

  // School year transition
  const [showYearModal,    setShowYearModal]    = useState(false);
  const [yearTransitioning, setYearTransitioning] = useState(false);
  const [yearError,        setYearError]        = useState("");
  const [yearSuccessToast, setYearSuccessToast] = useState(false);

  // Share with Family
  type FamilyInvite = {
    id: string; token: string; email: string; viewer_name: string | null;
    is_active: boolean; trial_ends_at: string | null; last_visited_at: string | null;
    first_visited_at: string | null;
  };
  const [familyInvites,     setFamilyInvites]     = useState<FamilyInvite[]>([]);
  const [familyInviteEmail, setFamilyInviteEmail] = useState("");
  const [familyInviteName,  setFamilyInviteName]  = useState("");
  const [sendingInvite,     setSendingInvite]     = useState(false);
  const [inviteSent,        setInviteSent]        = useState(false);
  const [inviteError,       setInviteError]       = useState("");
  const [editingInvite,     setEditingInvite]     = useState<string | null>(null);
  const [editInvName,       setEditInvName]       = useState("");
  const [editInvEmail,      setEditInvEmail]      = useState("");
  const [editInvExpiry,     setEditInvExpiry]     = useState<"30" | "90" | "365" | "never">("90");
  const [savingInvEdit,     setSavingInvEdit]     = useState(false);
  const [resendingId,       setResendingId]       = useState<string | null>(null);
  const [resentId,          setResentId]          = useState<string | null>(null);
  const [actioningId,       setActioningId]       = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setUserEmail(user.email ?? "");

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, partner_email, family_photo_url, state, is_pro, plan_type, current_period_end, subscription_status, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();

    setFirstName((profile as { first_name?: string } | null)?.first_name ?? user.user_metadata?.first_name ?? "");
    setLastName((profile as { last_name?: string } | null)?.last_name ?? user.user_metadata?.last_name ?? "");
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
      .select("id, name, color, sort_order, archived, graduated_at, birthday")
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("sort_order");

    setChildren(kids ?? []);
    setLoadingChildren(false);

    // Load affiliate data if exists
    const { data: affData } = await supabase
      .from("affiliates")
      .select("code, stripe_coupon_id, is_active, created_at, clicks")
      .eq("user_id", user.id)
      .maybeSingle();
    if (affData) setAffiliateData(affData as { code: string; stripe_coupon_id: string; is_active: boolean; created_at: string; clicks: number });

    // Admin: load all affiliates
    const admin = ADMIN_EMAILS.includes(user.email ?? "");
    setIsAdmin(admin);
    if (admin) {
      const { data: allAff } = await supabase
        .from("affiliates")
        .select("id, name, code, stripe_coupon_id, is_active, created_at, user_id, clicks")
        .order("created_at", { ascending: false });
      setAllAffiliates((allAff ?? []) as AffiliateRow[]);
    }

    // Load family invites (all viewers)
    const { data: invites } = await supabase
      .from("family_invites")
      .select("id, token, email, viewer_name, is_active, trial_ends_at, last_visited_at, first_visited_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (invites) {
      setFamilyInvites(invites as FamilyInvite[]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendFamilyInvite() {
    if (!familyInviteEmail.trim() || !familyInviteName.trim()) return;
    setSendingInvite(true);
    setInviteError("");
    setInviteSent(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setInviteError("Not logged in"); setSendingInvite(false); return; }
      const res = await fetch("/api/family/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: familyInviteEmail.trim(), viewerName: familyInviteName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setInviteError(json.error ?? "Failed to send invite");
      } else {
        setInviteSent(true);
        setFamilyInviteEmail("");
        setFamilyInviteName("");
        setTimeout(() => setInviteSent(false), 3000);
        load(); // Refresh invites list
      }
    } catch {
      setInviteError("Network error");
    }
    setSendingInvite(false);
  }

  async function resendFamilyInvite(inv: FamilyInvite) {
    setResendingId(inv.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/family/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: inv.email, viewerName: inv.viewer_name ?? "Friend", resend: true }),
      });
      setResentId(inv.id);
      setTimeout(() => setResentId(null), 3000);
    } catch {}
    setResendingId(null);
  }

  async function saveInviteEdit(inv: FamilyInvite) {
    setSavingInvEdit(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const trialEndsAt = editInvExpiry === "never"
        ? null
        : new Date(Date.now() + Number(editInvExpiry) * 24 * 60 * 60 * 1000).toISOString();
      await fetch("/api/family/invite", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({
          inviteId: inv.id,
          viewerName: editInvName.trim() || undefined,
          email: editInvEmail.trim() !== inv.email ? editInvEmail.trim() : undefined,
          trialEndsAt,
        }),
      });
      setEditingInvite(null);
      load();
    } catch {}
    setSavingInvEdit(false);
  }

  async function revokeInvite(inv: FamilyInvite) {
    setActioningId(inv.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/family/invite", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ inviteId: inv.id, action: "revoke" }),
      });
      load();
    } catch {}
    setActioningId(null);
  }

  async function reactivateInvite(inv: FamilyInvite) {
    setActioningId(inv.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch("/api/family/invite", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ inviteId: inv.id, action: "reactivate" }),
      });
      load();
    } catch {}
    setActioningId(null);
  }

  function showCopiedToast(msg = "Copied!") {
    setCopiedToast(msg);
    setTimeout(() => setCopiedToast(false), 2000);
  }

  useEffect(() => {
    if (affiliateData?.stripe_coupon_id && affiliateData?.code) {
      fetch(`/api/stripe/affiliate-stats?coupon_id=${affiliateData.stripe_coupon_id}&code=${encodeURIComponent(affiliateData.code)}`)
        .then(r => r.json())
        .then(setAffiliateStats)
        .catch(() => {});
    }
  }, [affiliateData]);

  // ── First / Last name ─────────────────────────────────────────────────────

  async function saveFirstName() {
    setSavingFirst(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) { setSavingFirst(false); return; }
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ first_name: firstName.trim() || null }),
    });
    setSavingFirst(false);
    setSavedFirst(true);
    setEditingFirst(false);
    refreshProfile();
    setTimeout(() => setSavedFirst(false), 2500);
  }

  async function saveLastName() {
    setSavingLast(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) { setSavingLast(false); return; }
    await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ last_name: lastName.trim() || null }),
    });
    setSavingLast(false);
    setSavedLast(true);
    setEditingLast(false);
    refreshProfile();
    setTimeout(() => setSavedLast(false), 2500);
  }

  // ── Family name ───────────────────────────────────────────────────────────

  async function saveFamilyName() {
    const nameToSave = familyName.trim();
    console.log("[Settings] saveFamilyName() called — familyName state value:", JSON.stringify(nameToSave));
    setSavingFamily(true);

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { setSavingFamily(false); console.log("[Settings] saveFamilyName: no token, aborting"); return; }

    // Primary: API route (uses service role key, bypasses RLS)
    const res = await fetch("/api/profile/update", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ display_name: nameToSave }),
    });
    const resBody = await res.json().catch(() => ({}));
    console.log("[Settings] API route response:", res.status, JSON.stringify(resBody));

    // Fallback: direct Supabase client update in case API route failed
    if (!res.ok) {
      console.log("[Settings] API route failed — attempting direct Supabase fallback");
      const userId = session.user.id;
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from("profiles")
        .update({ display_name: nameToSave })
        .eq("id", userId)
        .select();
      console.log("[Settings] direct Supabase fallback result — data:", JSON.stringify(fallbackData), "error:", fallbackErr?.message ?? null);
    }

    setSavingFamily(false);
    setSavedFamily(true);
    setEditingName(false);
    refreshProfile();
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
    refreshProfile();
    setTimeout(() => setSavedState(false), 2500);
  }

  // ── Password reset ────────────────────────────────────────────────────────

  async function sendPasswordReset() {
    if (!userEmail) return;
    setResetSending(true);
    setResetError("");
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
      redirectTo: "https://rootedhomeschoolapp.com/reset-password",
    });
    setResetSending(false);
    if (error) {
      setResetError(error.message);
    } else {
      setResetSent(true);
    }
  }

  // ── Close account ─────────────────────────────────────────────────────────

  async function closeAccount() {
    if (deleteConfirmText !== "DELETE") return;
    setDeletingAccount(true);
    setDeleteError("");
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) { setDeletingAccount(false); setDeleteError("Not authenticated."); return; }
    const res = await fetch("/api/account/delete", {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? "Something went wrong. Please try again.");
      setDeletingAccount(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.href = "/signup?deleted=1";
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
      console.error("[Settings] Photo upload error:", uploadErr);
      setPhotoError(
        uploadErr.message.includes("Bucket not found")
          ? "Create a public storage bucket named 'family-photos' in Supabase first."
          : `Upload failed: ${uploadErr.message}`
      );
      setPhotoUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("family-photos").getPublicUrl(path);
    // Cache-bust so re-uploads to the same storage path always show the new image
    const url = `${urlData.publicUrl}?t=${Date.now()}`;

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
      const body = await res.json().catch(() => ({}));
      console.error("[Settings] Photo profile update error:", body);
      setPhotoError(`Saved photo but couldn't update profile: ${body.error ?? "unknown error"}`);
      setPhotoUploading(false);
      return;
    }

    setFamilyPhotoUrl(url);
    setPhotoUploading(false);
    setPhotoError(null);
    refreshProfile();
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
      .select("id, name, color, sort_order, archived, graduated_at, birthday")
      .single();

    if (error) {
      setAddError(error.message);
    } else if (data) {
      setChildren((prev) => [...prev, data]);
      setNewName("");
      setNewColor(COLORS[0].value);
      window.dispatchEvent(new CustomEvent("rooted:children-updated"));
    }
    setAddingChild(false);
  }

  // ── Edit child ────────────────────────────────────────────────────────────

  function startEdit(child: Child) {
    setEditingId(child.id);
    setEditName(child.name);
    setEditColor(child.color ?? COLORS[0].value);
    setEditError("");
    setDeleteId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditColor("");
    setEditError("");
  }

  async function saveEdit(id: string) {
    const updatedName = editName.trim();
    if (!updatedName) return;
    const updatedColor = editColor;

    // No-op: name and color unchanged
    const current = children.find((c) => c.id === id);
    if (current && current.name === updatedName && current.color === updatedColor) {
      setEditingId(null);
      return;
    }

    setSavingEdit(true);
    setEditError("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setEditError("Not logged in."); return; }

      // Clean up any duplicate rows with the target name (from a partially-failed previous save)
      await supabase
        .from("children")
        .delete()
        .eq("user_id", user.id)
        .eq("name", updatedName)
        .neq("id", id);

      const { error } = await supabase
        .from("children")
        .update({ name: updatedName, color: updatedColor })
        .eq("id", id);

      if (error) {
        console.error("[Settings] Child update failed:", error.message);
        setEditError(error.message.includes("unique") ? "That name is already taken." : "Save failed — try again.");
        return;
      }

      setChildren((prev) =>
        prev.map((c) => c.id === id ? { ...c, name: updatedName, color: updatedColor } : c)
      );
      setEditingId(null);
      window.dispatchEvent(new CustomEvent("rooted:children-updated"));
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Delete child (soft-archive) ───────────────────────────────────────────

  async function archiveChild(id: string) {
    setDeletingId(id);

    // Safety: log if archiving for a paying subscriber (user-initiated, but tracked)
    if (isPro || subscriptionStatus === 'active') {
      console.warn('[settings] Archiving child for paying subscriber — user-initiated. childId:', id, 'isPro:', isPro, 'status:', subscriptionStatus);
    }

    const { error } = await supabase
      .from("children")
      .update({ archived: true })
      .eq("id", id);

    if (!error) {
      setChildren((prev) => prev.filter((c) => c.id !== id));
      window.dispatchEvent(new CustomEvent("rooted:children-updated"));
    }
    setDeletingId(null);
    setDeleteId(null);
  }

  // ── Graduate child ────────────────────────────────────────────────────────

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
      const saved = partnerEmail.trim();
      setSavedPartnerEmail(saved);
      setPartnerSaved(true);
      setTimeout(() => setPartnerSaved(false), 2500);
      // Fire-and-forget invite email — don't block UI
      fetch("/api/partner/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: saved, familyName }),
      }).catch(() => {});
    }
    setSavingPartner(false);
  }

  // ── Manage subscription ───────────────────────────────────────────────────

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPortalLoading(false); return; }
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (data.error === 'no_customer' || !data.url) {
        showCopiedToast("Unable to load subscription management. Please contact hello@rootedhomeschoolapp.com");
        setPortalLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      showCopiedToast("Unable to load subscription management. Please contact hello@rootedhomeschoolapp.com");
      setPortalLoading(false);
    }
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
    <div className="max-w-xl px-5 py-7 space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-0.5">
          Manage your account
        </p>
        <h1 className="text-2xl font-bold text-[#2d2926]">Settings ⚙️</h1>
      </div>

      {/* ── Tab navigation ─────────────────────────────────── */}
      <div className="flex gap-1.5 bg-[#f0ede8] rounded-full p-1 w-fit overflow-x-auto">
        {(["family", "kids", "account", ...(isAdmin ? ["partners" as SettingsTab] : [])] as SettingsTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === tab
                ? "bg-[#5c7f63] text-white shadow-sm"
                : "text-[#7a6f65] hover:text-[#2d2926]"
            }`}
          >
            {tab === "family" ? "Our Family" : tab === "kids" ? "Our Kids" : tab === "partners" ? "Partners" : "Account"}
          </button>
        ))}
      </div>

      {/* ── Our Family ────────────────────────────────────────── */}
      {activeTab === "family" && <section className="space-y-5">

        {/* Photo hero */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex flex-col items-center text-center">
          <p className="text-xs font-semibold text-[#7a6f65] uppercase tracking-widest mb-3">Your family photo</p>
          <button
            type="button"
            onClick={() => photoFileRef.current?.click()}
            disabled={photoUploading}
            className="relative group focus:outline-none mb-2"
            aria-label="Change family photo"
          >
            {familyPhotoUrl ? (
              <img
                src={familyPhotoUrl}
                alt="Family photo"
                className="w-[120px] h-[120px] rounded-full object-cover border-3 border-[#e8e2d9] group-hover:border-[#5c7f63] transition-colors"
              />
            ) : (
              <div className="w-[120px] h-[120px] rounded-full bg-[#e8f0e9] border-2 border-dashed border-[#c8ddb8] group-hover:border-[#5c7f63] flex items-center justify-center transition-colors">
                <Camera size={32} className="text-[#7aaa78]" />
              </div>
            )}
            {/* Camera overlay */}
            <div className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-[#5c7f63] border-2 border-white flex items-center justify-center shadow-sm">
              <Camera size={14} className="text-white" />
            </div>
            {photoUploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <span className="text-white text-xs font-bold animate-pulse">Uploading…</span>
              </div>
            )}
          </button>
          <p className="text-[11px] text-[#b5aca4]">Tap to change · Shown on your shareable family updates</p>
          <input
            ref={photoFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) uploadFamilyPhoto(file);
            }}
          />
          {photoError && (
            <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {photoError}
            </p>
          )}
        </div>

        {/* Name fields */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">

          {/* First + Last name — side by side on desktop */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* First name */}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">First name</label>
              {editingFirst ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveFirstName(); if (e.key === "Escape") setEditingFirst(false); }}
                    autoFocus
                    placeholder="Jane"
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[#5c7f63] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/15 transition"
                  />
                  <button
                    onClick={saveFirstName}
                    disabled={savingFirst}
                    className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                      savedFirst ? "bg-[#e8f0e9] text-[#3d5c42]" : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                    }`}
                  >
                    {savedFirst ? "✓" : savingFirst ? "…" : "Save"}
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditingFirst(true)} className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-[#fefcf9] hover:border-[#c8bfb5] transition-colors text-left">
                  <span className="flex-1 text-sm text-[#2d2926]">
                    {firstName || <span className="text-[#c8bfb5]">Add first name</span>}
                  </span>
                  <Pencil size={13} className="text-[#b5aca4] shrink-0" />
                </button>
              )}
            </div>

            {/* Last name */}
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Last name</label>
              {editingLast ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveLastName(); if (e.key === "Escape") setEditingLast(false); }}
                    autoFocus
                    placeholder="Smith"
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[#5c7f63] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/15 transition"
                  />
                  <button
                    onClick={saveLastName}
                    disabled={savingLast}
                    className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                      savedLast ? "bg-[#e8f0e9] text-[#3d5c42]" : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                    }`}
                  >
                    {savedLast ? "✓" : savingLast ? "…" : "Save"}
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditingLast(true)} className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-[#fefcf9] hover:border-[#c8bfb5] transition-colors text-left">
                  <span className="flex-1 text-sm text-[#2d2926]">
                    {lastName || <span className="text-[#c8bfb5]">Add last name</span>}
                  </span>
                  <Pencil size={13} className="text-[#b5aca4] shrink-0" />
                </button>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-[#e8e2d9]" />

          {/* Family name */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Family name</label>
            {editingName ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveFamilyName(); if (e.key === "Escape") setEditingName(false); }}
                  autoFocus
                  placeholder="e.g. The Waltrip Family"
                  className="flex-1 px-3 py-2.5 rounded-xl border border-[#5c7f63] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/15 transition"
                />
                <button
                  onClick={saveFamilyName}
                  disabled={savingFamily || !familyName.trim()}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                    savedFamily ? "bg-[#e8f0e9] text-[#3d5c42]" : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                  }`}
                >
                  {savedFamily ? "✓" : savingFamily ? "…" : "Save"}
                </button>
              </div>
            ) : (
              <button onClick={() => setEditingName(true)} className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-[#fefcf9] hover:border-[#c8bfb5] transition-colors text-left">
                <span className="flex-1 text-sm text-[#2d2926]">
                  {familyName || <span className="text-[#c8bfb5]">Add family name</span>}
                </span>
                <Pencil size={13} className="text-[#b5aca4] shrink-0" />
              </button>
            )}
            <p className="text-[11px] text-[#b5aca4] mt-1.5 px-1">This is how your family appears in the app greeting</p>
          </div>

          {/* Divider */}
          <div className="h-px bg-[#e8e2d9]" />

          {/* Email (read-only) */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Email address</label>
            <p className="text-sm text-[#b5aca4] px-3 py-2.5 bg-[#f8f5f0] rounded-xl border border-[#f0ede8]">
              {userEmail || "—"}
            </p>
          </div>

          {/* State */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Your state</label>
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
                className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors shrink-0 ${
                  savedState ? "bg-[#e8f0e9] text-[#3d5c42]" : "bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-40 text-white"
                }`}
              >
                {savedState ? "✓" : savingState ? "…" : "Save"}
              </button>
            </div>
            <p className="text-[11px] text-[#b5aca4] mt-1.5 px-1">Used to personalize your Resources tab</p>
          </div>
        </div>
      </section>}

      {/* ── Children ────────────────────────────────────────── */}
      {activeTab === "kids" && <section className="space-y-3">
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
                    <div>
                      <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">
                        Birthday <span className="text-[#b5aca4] font-normal">(optional)</span>
                      </label>
                      <input
                        type="date"
                        value={(() => { const c = children.find(ch => ch.id === editingId); return c?.birthday ?? ""; })()}
                        onChange={async (e) => {
                          const val = e.target.value || null;
                          await supabase.from("children").update({ birthday: val }).eq("id", editingId!);
                          setChildren(prev => prev.map(c => c.id === editingId ? { ...c, birthday: val } : c));
                        }}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/15 transition"
                      />
                    </div>
                    {editError && (
                      <p className="text-xs text-red-600 font-medium">{editError}</p>
                    )}
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

                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-[#2d2926]">{child.name}</span>
                      {child.birthday && (
                        <p className="text-[10px] text-[#b5aca4]">
                          🎂 {new Date(child.birthday + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      )}
                    </div>

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
                      ) : null}
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
      </section>}

      {/* ── Share your journey ──────────────────────────────── */}
      {activeTab === "family" && <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Share your journey 🌿</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
          {/* Viewer count */}
          {(() => {
            const activeCount = familyInvites.filter(i => i.is_active).length;
            return activeCount > 0 ? (
              <p className="text-xs text-[#5c7f63] font-medium">
                {activeCount} {activeCount === 1 ? "person is" : "people are"} following your family&apos;s journey 🌿
              </p>
            ) : (
              <p className="text-xs text-[#7a6f65] leading-relaxed">
                Invite grandparents, aunts, uncles, or anyone who wants to follow your family&apos;s story. They&apos;ll see your memories and can leave reactions and comments.
              </p>
            );
          })()}

          {/* Preview button */}
          <button
            onClick={() => {
              const token = familyInvites[0]?.token;
              window.open(token ? `/family/${token}` : "/family/preview", "_blank");
            }}
            className="w-full border border-[#c8dfc8] bg-[#f0f7f0] text-[#3d5c42] rounded-xl py-2.5 mb-4 text-sm font-medium flex items-center justify-center gap-2"
          >
            👁 Preview family view
          </button>

          {/* Invite form */}
          <div className="space-y-2 pt-2 border-t border-[#f0ede8]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a8f85]">Add a viewer</p>
            <input
              type="text"
              value={familyInviteName}
              onChange={(e) => setFamilyInviteName(e.target.value)}
              placeholder="Viewer's name (e.g. Grandma Jean)"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
            />
            <input
              type="email"
              value={familyInviteEmail}
              onChange={(e) => { setFamilyInviteEmail(e.target.value); setInviteError(""); }}
              placeholder="Email address"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder:text-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20"
              onKeyDown={(e) => { if (e.key === "Enter") sendFamilyInvite(); }}
            />
            <div className="bg-[#f5f0e8] border border-[#e8e0d9] rounded-xl px-4 py-3">
              <p className="text-[11px] text-[#7a6f65] leading-relaxed">
                👁 All your memories are visible to invited family by default. Open any memory and tap &apos;Visible to family&apos; to make it private.
              </p>
            </div>
            <button
              onClick={sendFamilyInvite}
              disabled={sendingInvite || !familyInviteEmail.trim() || !familyInviteName.trim()}
              className="w-full py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {sendingInvite ? "Sending..." : "Send invite 🌿"}
            </button>
            {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
            {inviteSent && <p className="text-xs text-[#5c7f63] font-medium">Invite sent! They&apos;ll get an email with a link to your memories.</p>}
            <p className="text-[11px] text-[#b5aca4]">Anyone with this link can view your family&apos;s memories. Only invite people you trust.</p>
          </div>

          {/* Viewer list */}
          {familyInvites.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#f0ede8]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a8f85]">Your viewers</p>
              {familyInvites.map((inv) => {
                const isEditing = editingInvite === inv.id;
                const daysAgoVisited = inv.last_visited_at
                  ? Math.floor((Date.now() - new Date(inv.last_visited_at).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                const expiryInfo = (() => {
                  if (!inv.trial_ends_at) return { label: "Access · Never expires", warn: false };
                  const daysLeft = Math.ceil((new Date(inv.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  if (daysLeft <= 0) return { label: "Expired", warn: true };
                  if (daysLeft <= 7) return { label: `⚠️ Expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`, warn: true };
                  return { label: `Expires ${new Date(inv.trial_ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, warn: false };
                })();

                return (
                  <div key={inv.id} className="bg-white border border-[#e8e2d9] rounded-xl p-3 space-y-2">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={editInvName} onChange={(e) => setEditInvName(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                          placeholder="Name"
                        />
                        <input
                          value={editInvEmail} onChange={(e) => setEditInvEmail(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                          placeholder="Email"
                        />
                        <div>
                          <label className="text-[11px] text-[#7a6f65] mb-0.5 block">Access expires</label>
                          <select
                            value={editInvExpiry}
                            onChange={(e) => setEditInvExpiry(e.target.value as "30" | "90" | "365" | "never")}
                            className="w-full px-3 py-2 rounded-lg border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                          >
                            <option value="30">30 days</option>
                            <option value="90">90 days</option>
                            <option value="365">1 year</option>
                            <option value="never">Never</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setEditingInvite(null)} className="px-3 py-1.5 rounded-lg border border-[#e8e2d9] text-xs text-[#7a6f65]">Cancel</button>
                          <button
                            onClick={() => saveInviteEdit(inv)} disabled={savingInvEdit}
                            className="px-3 py-1.5 rounded-lg bg-[#5c7f63] text-white text-xs font-medium disabled:opacity-50"
                          >
                            {savingInvEdit ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="text-sm font-medium text-[#2d2926]">
                            {inv.viewer_name ?? "Viewer"}
                            <span className="ml-2 text-xs font-normal text-[#7a6f65]">{inv.email}</span>
                          </p>
                          <p className="text-[11px] text-[#b5aca4] mt-0.5">
                            {inv.is_active ? (
                              <>
                                <span className="text-[#5c7f63] font-medium">Active</span>
                                {" · "}<span className={expiryInfo.warn ? "text-amber-600 font-medium" : ""}>{expiryInfo.label}</span>
                                {daysAgoVisited !== null ? (
                                  <> · Last visited {daysAgoVisited === 0 ? "today" : `${daysAgoVisited}d ago`}</>
                                ) : (
                                  <> · Never opened</>
                                )}
                              </>
                            ) : (
                              <span className="text-[#c4697a] font-medium">Revoked</span>
                            )}
                          </p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {inv.is_active ? (
                            <>
                              <button
                                onClick={() => { setEditingInvite(inv.id); setEditInvName(inv.viewer_name ?? ""); setEditInvEmail(inv.email); setEditInvExpiry(inv.trial_ends_at ? (() => { const days = Math.round((new Date(inv.trial_ends_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)); return days <= 30 ? "30" : days <= 90 ? "90" : "365"; })() as "30" | "90" | "365" : "never"); }}
                                className="px-2.5 py-1 rounded-lg border border-[#e8e2d9] text-[11px] text-[#7a6f65] hover:bg-[#f0ede8] transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => resendFamilyInvite(inv)}
                                disabled={resendingId === inv.id}
                                className="px-2.5 py-1 rounded-lg border border-[#e8e2d9] text-[11px] text-[#7a6f65] hover:bg-[#f0ede8] transition-colors disabled:opacity-50"
                              >
                                {resentId === inv.id ? "Sent!" : resendingId === inv.id ? "Sending..." : "Resend invite"}
                              </button>
                              <button
                                onClick={() => revokeInvite(inv)}
                                disabled={actioningId === inv.id}
                                className="px-2.5 py-1 rounded-lg border border-red-200 text-[11px] text-red-400 hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                Revoke
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => reactivateInvite(inv)}
                              disabled={actioningId === inv.id}
                              className="px-2.5 py-1 rounded-lg bg-[#5c7f63] text-[11px] text-white font-medium hover:bg-[#3d5c42] transition-colors disabled:opacity-50"
                            >
                              {actioningId === inv.id ? "..." : "Re-invite"}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>}

      {/* ── Co-teacher Access ───────────────────────────────── */}
      {activeTab === "family" && <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Co-teacher Access</h2>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#e8f0e9] text-[#5c7f63]">Coming Soon 🌿</span>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#e8f0e9] flex items-center justify-center shrink-0">
              <Users size={16} className="text-[#5c7f63]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#2d2926] mb-0.5">Co-teacher access is coming soon</p>
              <p className="text-xs text-[#7a6f65] leading-relaxed">
                Your partner will be able to view lessons and memories — we&apos;re building this now and will let you know when it&apos;s ready.
              </p>
            </div>
          </div>
        </div>
      </section>}

      {/* ── School Year ─────────────────────────────────────── */}
      {activeTab === "family" && <section className="space-y-3">
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
      </section>}

      {/* ── Subscription ────────────────────────────────────── */}
      {activeTab === "account" && <section className="space-y-3">
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
            {(subscriptionStatus === 'active' || planType === 'founding_family' || planType === 'standard') ? (
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="shrink-0 px-4 py-2 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#2d2926] hover:bg-[#f0ede8] disabled:opacity-40 transition-colors"
              >
                {portalLoading ? 'Loading…' : 'Manage Subscription'}
              </button>
            ) : ADMIN_EMAILS.includes(userEmail) ? (
              <span className="text-xs text-[#9e958d] italic shrink-0">Admin — managed via Stripe dashboard</span>
            ) : (
              <a
                href="/upgrade"
                className="shrink-0 px-4 py-2 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-medium transition-colors"
              >
                Upgrade to Founding Family →
              </a>
            )}
          </div>
        </div>
      </section>}

      {/* ── Account / Danger zone ────────────────────────────── */}
      {activeTab === "account" && <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[#2d2926]">Account</h2>
          <span className="h-px flex-1 bg-[#e8e2d9]" />
        </div>

        {/* Reset password */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-[#2d2926]">Reset Password</p>
            <p className="text-xs text-[#7a6f65] mt-0.5">We&apos;ll send a reset link to <span className="font-medium">{userEmail}</span></p>
          </div>
          {resetSent ? (
            <p className="text-sm text-[#5c7f63] font-medium">✓ Password reset email sent! Check your inbox.</p>
          ) : (
            <>
              <button
                onClick={sendPasswordReset}
                disabled={resetSending || !userEmail}
                className="px-4 py-2 rounded-xl border border-[#c8ddb8] text-[#3d5c42] text-sm font-medium hover:bg-[#f2f9f3] disabled:opacity-50 transition-colors"
              >
                {resetSending ? "Sending…" : "Reset Password"}
              </button>
              {resetError && <p className="text-xs text-red-600">{resetError}</p>}
            </>
          )}
        </div>

        {/* Close account */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-[#2d2926]">Close My Account</p>
            <p className="text-xs text-[#7a6f65] mt-0.5">Permanently deletes your account and all family data.</p>
          </div>
          <button
            onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(""); setDeleteError(""); }}
            className="px-4 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Close My Account
          </button>
        </div>

        {/* Contact */}
        <p className="text-xs text-[#b5aca4] text-center">
          Questions? Email <span className="text-[#5c7f63] font-medium">hello@rootedhomeschoolapp.com</span>
        </p>
      </section>}

      {/* ── Close Account Modal ──────────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center space-y-1">
              <div className="text-3xl mb-2">⚠️</div>
              <h3 className="text-base font-bold text-[#2d2926]">Are you sure?</h3>
              <p className="text-sm text-[#7a6f65] leading-relaxed">
                This permanently deletes your account and all your family&apos;s data — lessons, memories, garden, everything. <strong>This cannot be undone.</strong>
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#7a6f65] block">Type <span className="font-mono text-red-600">DELETE</span> to confirm</label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full border border-[#e8e2d9] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>
            {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(""); setDeleteError(""); }}
                className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-[#7a6f65] text-sm font-medium hover:bg-[#f0ede8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={closeAccount}
                disabled={deleteConfirmText !== "DELETE" || deletingAccount}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-40 transition-colors"
              >
                {deletingAccount ? "Deleting…" : "Yes, Delete Everything"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin (only shown to admin email) ───────────────── */}
      {activeTab === "account" && userEmail === "garfieldbrittany@gmail.com" && (
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
            href="/admin"
            className="flex items-center justify-between bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 hover:border-[#5c7f63] hover:bg-[#f8fcf8] transition-colors group"
          >
            <div>
              <p className="text-sm font-medium text-[#2d2926]">📊 Founder Dashboard</p>
              <p className="text-xs text-[#7a6f65] mt-0.5">Users, revenue, costs, and app usage</p>
            </div>
            <span className="text-[#b5aca4] group-hover:text-[#5c7f63] text-lg">→</span>
          </a>
        </section>
      )}

      {/* ── Partners Tab (admin only) ──────────────────────────────── */}
      {activeTab === "partners" && isAdmin && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
            Rooted Partners
          </h2>
          <p className="text-sm text-[#7a6f65]">
            {allAffiliates.length} partner{allAffiliates.length !== 1 ? "s" : ""}
          </p>

          {allAffiliates.length === 0 && (
            <p className="text-sm text-[#7a6f65]">No partners yet.</p>
          )}

          {/* Desktop table */}
          {allAffiliates.length > 0 && (
            <div className="hidden sm:block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-x-auto">
              <table className="min-w-[800px] w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e8e2d9] bg-[#f8f7f4]">
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Name</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Code</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Referral Link</th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Clicks</th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Families</th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Revenue</th>
                    <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Status</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#7a6f65]">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {allAffiliates.map((aff) => (
                    <tr key={aff.id} className="border-b border-[#f0ede8] last:border-0 hover:bg-[#f8f7f4] transition-colors">
                      <td className="px-4 py-3 font-medium text-[#2d2926]">{aff.name}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { navigator.clipboard.writeText(aff.code); showCopiedToast("Code copied!"); }}
                          className="font-mono font-bold text-[#4338ca] tracking-wider hover:underline cursor-pointer"
                        >
                          {aff.code}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { navigator.clipboard.writeText(`https://rootedhomeschoolapp.com/upgrade?ref=${aff.code}`); showCopiedToast("Link copied!"); }}
                          className="text-xs text-[#4338ca] hover:underline cursor-pointer truncate max-w-[200px] block"
                        >
                          ...?ref={aff.code}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-[#2d2926] font-medium">{aff.clicks ?? 0}</td>
                      <td className="px-4 py-3 text-right"><AffiliateStatCell couponId={aff.stripe_coupon_id} code={aff.code} field="totalRedemptions" /></td>
                      <td className="px-4 py-3 text-right"><AffiliateStatCell couponId={aff.stripe_coupon_id} code={aff.code} field="revenueDriven" prefix="$" /></td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          aff.is_active ? "bg-green-100 text-green-800" : "bg-[#f0ede8] text-[#7a6f65]"
                        }`}>
                          {aff.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#7a6f65]">
                        {new Date(aff.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Mobile cards */}
          {allAffiliates.length > 0 && (
            <div className="sm:hidden space-y-3">
              {allAffiliates.map((aff) => (
                <div key={aff.id} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm text-[#2d2926]">{aff.name}</p>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      aff.is_active ? "bg-green-100 text-green-800" : "bg-[#f0ede8] text-[#7a6f65]"
                    }`}>
                      {aff.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(aff.code); showCopiedToast("Code copied!"); }}
                    className="flex items-center justify-between w-full"
                  >
                    <span className="font-mono font-bold text-[#4338ca] tracking-wider">{aff.code}</span>
                    <span className="text-[11px] text-[#6366f1]">Tap to copy</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[#7a6f65]">
                    <span>{aff.clicks ?? 0} clicks</span>
                    <span>Families: <AffiliateStatCell couponId={aff.stripe_coupon_id} code={aff.code} field="totalRedemptions" /></span>
                    <span>Revenue: <AffiliateStatCell couponId={aff.stripe_coupon_id} code={aff.code} field="revenueDriven" prefix="$" /></span>
                    <span>Since {new Date(aff.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Kid View ─────────────────────────────────────────────────── */}
      <div className="mt-8 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden">
        <Link
          href="/child"
          className="flex items-center justify-between px-5 py-4 hover:bg-[#f8f5f0] transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-[#2d2926]">Kid view</p>
            <p className="text-xs text-[#7a6f65]">Show the garden to your child</p>
          </div>
          <span className="text-[#7a6f65]">→</span>
        </Link>
      </div>

      {/* ── Rooted Partner ───────────────────────────────────────────── */}
      {affiliateData?.is_active && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
            🤝 Rooted Partner
          </h2>
          <div className="bg-[#eef0ff] border border-[#c7d2fe] rounded-2xl p-5 space-y-4">

            {/* Code */}
            <div>
              <p className="text-xs font-semibold text-[#6366f1] uppercase tracking-widest mb-1">Your Code</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(affiliateData.code);
                  showCopiedToast("Code copied!");
                }}
                className="flex items-center gap-2 bg-white border border-[#c7d2fe] rounded-xl px-4 py-3 w-full text-left hover:bg-[#f5f5ff] transition-colors"
              >
                <span className="text-lg font-bold text-[#4338ca] tracking-widest font-mono flex-1">
                  {affiliateData.code}
                </span>
                <span className="text-xs text-[#6366f1]">Tap to copy</span>
              </button>
            </div>

            {/* Referral link */}
            <div>
              <p className="text-xs font-semibold text-[#6366f1] uppercase tracking-widest mb-1">Your Referral Link</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`https://rootedhomeschoolapp.com/upgrade?ref=${affiliateData.code}`);
                  showCopiedToast("Link copied!");
                }}
                className="flex items-center gap-2 bg-white border border-[#c7d2fe] rounded-xl px-4 py-3 w-full text-left hover:bg-[#f5f5ff] transition-colors"
              >
                <span className="text-sm text-[#4338ca] flex-1 truncate">
                  rootedhomeschoolapp.com/upgrade?ref={affiliateData.code}
                </span>
                <span className="text-xs text-[#6366f1] shrink-0">Tap to copy</span>
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 divide-x divide-[#c7d2fe] bg-white border border-[#c7d2fe] rounded-xl overflow-hidden">
              <div className="px-3 py-4 text-center">
                <p className="text-2xl font-bold text-[#2d2926]">{affiliateData.clicks ?? 0}</p>
                <p className="text-[11px] text-[#7a6f65] mt-0.5">Link clicks</p>
              </div>
              <div className="px-3 py-4 text-center">
                <p className="text-2xl font-bold text-[#2d2926]">{affiliateStats?.totalRedemptions ?? '—'}</p>
                <p className="text-[11px] text-[#7a6f65] mt-0.5">Families reached</p>
              </div>
              <div className="px-3 py-4 text-center">
                <p className="text-2xl font-bold text-[#3d5c42]">{affiliateStats?.payingCount ?? '—'}</p>
                <p className="text-[11px] text-[#7a6f65] mt-0.5">Now paying</p>
              </div>
              <div className="px-3 py-4 text-center">
                <p className="text-2xl font-bold text-[#2d2926]">${affiliateStats?.revenueDriven ?? '—'}</p>
                <p className="text-[11px] text-[#7a6f65] mt-0.5">Revenue driven</p>
              </div>
            </div>

            {/* QR Code */}
            <div>
              <p className="text-xs font-semibold text-[#6366f1] uppercase tracking-widest mb-2">Your QR Code</p>
              <div className="flex justify-center">
                <div className="bg-white border border-[#c7d2fe] rounded-2xl p-3">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://rootedhomeschoolapp.com/upgrade?ref=${affiliateData.code}`)}`}
                    alt="Referral QR code"
                    width={160}
                    height={160}
                    className="rounded-lg"
                  />
                </div>
              </div>
              <p className="text-[10px] text-[#6366f1] text-center mt-2">Screenshot to share anywhere</p>
            </div>

            {/* Download cards */}
            <div>
              <p className="text-xs font-semibold text-[#6366f1] uppercase tracking-widest mb-2">Download Your Cards</p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/affiliate/cards?name=${encodeURIComponent(affiliateData.code)}&code=${encodeURIComponent(affiliateData.code)}&url=${encodeURIComponent(`rootedhomeschoolapp.com/upgrade?ref=${affiliateData.code}`)}`);
                    const { cardHtml } = await res.json();
                    const blob = new Blob([cardHtml], { type: 'text/html' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${affiliateData.code}_card.html`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-[#c7d2fe] rounded-xl px-3 py-2.5 text-sm font-medium text-[#4338ca] hover:bg-[#f5f5ff] transition-colors"
                >
                  🖨️ Print card
                </button>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/affiliate/cards?name=${encodeURIComponent(affiliateData.code)}&code=${encodeURIComponent(affiliateData.code)}&url=${encodeURIComponent(`rootedhomeschoolapp.com/upgrade?ref=${affiliateData.code}`)}`);
                    const { shareHtml } = await res.json();
                    const blob = new Blob([shareHtml], { type: 'text/html' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${affiliateData.code}_share.html`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-[#c7d2fe] rounded-xl px-3 py-2.5 text-sm font-medium text-[#4338ca] hover:bg-[#f5f5ff] transition-colors"
                >
                  📱 Share card
                </button>
              </div>
              <p className="text-[10px] text-[#a0a0b8] text-center mt-2">Open in Chrome and print to PDF for best results</p>
            </div>

            {/* Partner since */}
            <p className="text-xs text-[#6366f1] text-center">
              Partner since {new Date(affiliateData.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </section>
      )}

      {/* ── Spread the word ──────────────────────────────────────────── */}
      <div className="mt-6">
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4">
          <p className="text-sm font-medium text-[#2d2926]">Spread the word 🌱</p>
          <p className="text-xs text-[#7a6f65] mt-0.5 mb-3">Know a homeschool mom who&apos;d love this? Send her the link.</p>
          <button
            onClick={async () => {
              const shareData = {
                title: "Rooted",
                text: "I\u2019ve been using Rooted to capture our homeschool memories \u2014 thought you might love it!",
                url: "https://rootedhomeschoolapp.com",
              };
              if (navigator.share) {
                try { await navigator.share(shareData); } catch {}
              } else {
                await navigator.clipboard.writeText(shareData.url);
                showCopiedToast("Link copied!");
              }
            }}
            className="px-4 py-2 rounded-xl bg-[#2d5a3d] hover:bg-[#3d5c42] text-white text-sm font-medium transition-colors"
          >
            Share with a friend
          </button>
          <p className="text-xs text-[#b5aca4] mt-3">
            Share what you love. Earn while you do it. <Link href="/partners" className="text-[#5c7f63] hover:underline">Become a Rooted Partner</Link>
          </p>
        </div>
      </div>

      {/* ── Help & More ──────────────────────────────────────────────── */}
      <div className="mt-6 mb-8">
        <p className="text-[10px] font-semibold text-[#7a6f65] uppercase tracking-widest mb-3 px-1">Help & More</p>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
          {[
            { label: "What's new",      href: "/dashboard/more/whats-new", sub: "Latest updates" },
            { label: "FAQ",             href: "/faq",                       sub: "Common questions" },
            { label: "Contact us",      href: "/contact",                   sub: "hello@rootedhomeschoolapp.com" },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-[#f8f5f0] transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-[#2d2926]">{item.label}</p>
                <p className="text-xs text-[#7a6f65]">{item.sub}</p>
              </div>
              <span className="text-[#c8bfb5]">→</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Sign Out ──────────────────────────────────────────────────── */}
      <button
        onClick={async () => {
          await supabase.auth.signOut();
          window.location.href = "/login";
        }}
        className="w-full text-center text-sm text-red-500 font-semibold py-4 mt-2"
      >
        Sign Out
      </button>

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
      {copiedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-[#4338ca] text-white px-5 py-2.5 rounded-xl shadow-lg text-sm font-semibold">
            {copiedToast}
          </div>
        </div>
      )}

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
