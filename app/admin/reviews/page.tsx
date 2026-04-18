"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAILS = ["garfieldbrittany@gmail.com", "christopherwaltrip@gmail.com", "hello@rootedhomeschoolapp.com"];

interface ReviewRow {
  id: string;
  name: string;
  rating: number;
  review_text: string;
  approved: boolean;
  created_at: string;
  user_id: string | null;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5 text-[#C4962A]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="text-sm">{i <= rating ? "★" : "☆"}</span>
      ))}
    </span>
  );
}

export default function AdminReviewsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "all">("pending");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !ADMIN_EMAILS.includes(user.email ?? "")) {
        router.push("/login");
        return;
      }
      setAuthed(true);
      loadReviews();
    })();
  }, [router]);

  async function loadReviews() {
    setLoading(true);
    const res = await fetch("/api/admin/reviews");
    const data = await res.json();
    if (Array.isArray(data)) setReviews(data);
    setLoading(false);
  }

  async function toggleApproval(id: string, currentlyApproved: boolean) {
    const res = await fetch("/api/admin/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approved: !currentlyApproved }),
    });
    if (res.ok) {
      setReviews((prev) =>
        prev.map((r) => (r.id === id ? { ...r, approved: !currentlyApproved } : r))
      );
    }
  }

  async function deleteReview(id: string) {
    if (!confirm("Delete this review permanently?")) return;
    const res = await fetch("/api/admin/reviews", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setReviews((prev) => prev.filter((r) => r.id !== id));
    }
  }

  if (!authed) return null;

  const filtered = reviews.filter((r) => {
    if (filter === "pending") return !r.approved;
    if (filter === "approved") return r.approved;
    return true;
  });

  const pendingCount = reviews.filter((r) => !r.approved).length;

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back nav */}
        <Link
          href="/admin"
          className="text-sm text-[#5c7f63] hover:underline mb-4 inline-block"
        >
          ← Back to Admin
        </Link>

        <h1 className="text-2xl font-bold text-[#2d2926] mb-1">Review Moderation</h1>
        <p className="text-sm text-[#7a6f65] mb-6">
          {pendingCount > 0 ? `${pendingCount} review${pendingCount > 1 ? "s" : ""} waiting for approval` : "No pending reviews"}
        </p>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6">
          {(["pending", "approved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-[#2D5A3D] text-white"
                  : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63]"
              }`}
            >
              {f === "pending" ? `Pending (${pendingCount})` : f === "approved" ? `Approved (${reviews.filter(r => r.approved).length})` : `All (${reviews.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-[#7a6f65] py-10">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[#7a6f65]">
            {filter === "pending" ? "No pending reviews — all caught up!" : "No reviews found."}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <div
                key={r.id}
                className={`bg-white border rounded-xl p-5 ${
                  r.approved ? "border-[#e8e2d9]" : "border-[#C4962A]/30 bg-amber-50/30"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-[#2d2926] text-sm">{r.name}</span>
                      <Stars rating={r.rating} />
                      {r.approved && (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                          Live
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#5a534d] leading-relaxed mb-2">{r.review_text}</p>
                    <p className="text-[10px] text-[#b5aea6]">
                      {new Date(r.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleApproval(r.id, r.approved)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        r.approved
                          ? "bg-[#f0ede8] text-[#7a6f65] hover:bg-red-50 hover:text-red-600"
                          : "bg-[#2D5A3D] text-white hover:bg-[#3d5c48]"
                      }`}
                    >
                      {r.approved ? "Unapprove" : "Approve"}
                    </button>
                    <button
                      onClick={() => deleteReview(r.id)}
                      className="text-[11px] text-[#b5aea6] hover:text-red-500 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
