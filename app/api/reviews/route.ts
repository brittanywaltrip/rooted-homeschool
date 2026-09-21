import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// GET — fetch approved reviews (public)
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select("id, name, rating, review_text, created_at")
    .eq("approved", true)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST — submit a new review (authenticated users)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, rating, review_text, user_id } = body;

    if (!name || !rating || !review_text) {
      return NextResponse.json(
        { error: "Name, rating, and review are required." },
        { status: 400 }
      );
    }

    if (typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5." },
        { status: 400 }
      );
    }

    if (review_text.length > 1000) {
      return NextResponse.json(
        { error: "Review must be under 1000 characters." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from("reviews").insert({
      name: name.trim(),
      rating,
      review_text: review_text.trim(),
      user_id: user_id || null,
      approved: false,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
