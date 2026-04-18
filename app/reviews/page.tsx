"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

interface Review {
  id: string;
  name: string;
  rating: number;
  review_text: string;
  created_at: string;
}

function Stars({ rating, interactive, onRate }: { rating: number; interactive?: boolean; onRate?: (r: number) => void }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={!interactive}
          onClick={() => onRate?.(i)}
          className={`text-lg ${interactive ? "cursor-pointer hover:scale-110 transition-transform" : "cursor-default"}`}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
        >
          {i <= rating ? "★" : "☆"}
        </button>
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Get current user if logged in
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUserId(data.user.id);
      }
    });

    // Fetch approved reviews
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setReviews(data);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Please enter your name."); return; }
    if (rating === 0) { setError("Please select a star rating."); return; }
    if (!reviewText.trim()) { setError("Please write a short review."); return; }
    if (reviewText.length > 1000) { setError("Review must be under 1000 characters."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          rating,
          review_text: reviewText.trim(),
          user_id: userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");

      setSubmitted(true);
      setName("");
      setRating(0);
      setReviewText("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      {/* Header */}
      <header className="bg-[#1a2c22] text-[#f8f7f4]">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/rooted-logo-white.png" alt="Rooted" className="h-7" />
          </Link>
          <Link
            href="/login"
            className="text-sm text-[#f8f7f4]/80 hover:text-[#f8f7f4] transition-colors"
          >
            Log in
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-semibold text-[#2d2926] mb-2">
            What Families Are Saying
          </h1>
          <p className="text-[#7a6f65] text-base max-w-lg mx-auto">
            Real words from real homeschool families using Rooted every day.
          </p>
          {avgRating && reviews.length >= 3 && (
            <div className="mt-4 inline-flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-full px-4 py-1.5 text-sm text-[#2d2926]">
              <Stars rating={Math.round(Number(avgRating))} />
              <span className="font-medium">{avgRating}</span>
              <span className="text-[#7a6f65]">from {reviews.length} reviews</span>
            </div>
          )}
        </div>

        {/* Reviews grid */}
        {loading ? (
          <div className="text-center py-16 text-[#7a6f65]">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#7a6f65] text-base mb-1">No reviews yet — be the first!</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 mb-12">
            {reviews.map((r) => (
              <div
                key={r.id}
                className="bg-white border border-[#e8e2d9] rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-[#2d2926] text-sm">{r.name}</span>
                  <Stars rating={r.rating} />
                </div>
                <p className="text-[#5a534d] text-sm leading-relaxed">{r.review_text}</p>
                <p className="text-[10px] text-[#b5aea6] mt-3">
                  {new Date(r.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Submission form */}
        <div className="max-w-md mx-auto">
          <div className="bg-white border border-[#e8e2d9] rounded-xl p-6">
            <h2 className="text-lg font-semibold text-[#2d2926] mb-1">Leave a Review</h2>
            <p className="text-xs text-[#7a6f65] mb-5">
              Your review will appear after approval. We read every one!
            </p>

            {submitted ? (
              <div className="text-center py-6">
                <p className="text-[#5c7f63] font-medium mb-1">Thank you!</p>
                <p className="text-sm text-[#7a6f65]">
                  Your review has been submitted and will appear once approved.
                </p>
                <button
                  onClick={() => setSubmitted(false)}
                  className="mt-4 text-sm text-[#5c7f63] underline"
                >
                  Submit another
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#2d2926] mb-1">
                    Your name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="First name or family name"
                    maxLength={100}
                    className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/30 focus:border-[#5c7f63]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#2d2926] mb-1">
                    Rating
                  </label>
                  <div className="text-2xl text-[#C4962A]">
                    <Stars rating={rating} interactive onRate={setRating} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#2d2926] mb-1">
                    Your review
                  </label>
                  <textarea
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    placeholder="What do you love about Rooted? How has it helped your family?"
                    rows={4}
                    maxLength={1000}
                    className="w-full border border-[#e8e2d9] rounded-lg px-3 py-2 text-sm text-[#2d2926] bg-[#fefcf9] resize-none focus:outline-none focus:ring-2 focus:ring-[#5c7f63]/30 focus:border-[#5c7f63]"
                  />
                  <p className="text-[10px] text-[#b5aea6] text-right mt-0.5">
                    {reviewText.length}/1000
                  </p>
                </div>

                {error && (
                  <p className="text-xs text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-[#2D5A3D] text-white text-sm font-medium py-2.5 rounded-lg hover:bg-[#3d5c48] transition-colors disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit Review"}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-10 mb-6">
          <p className="text-sm text-[#7a6f65] mb-3">
            Ready to try the app these families love?
          </p>
          <Link
            href="/signup"
            className="inline-block bg-[#2D5A3D] text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-[#3d5c48] transition-colors"
          >
            Get Started Free
          </Link>
        </div>
      </main>
    </div>
  );
}
