import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST: Create a gift checkout by recipient email (public — no auth required)
export async function POST(req: NextRequest) {
  try {
    const { email, gifterName } = await req.json();

    if (!email?.trim()) {
      return NextResponse.json({ error: "Please enter an email address." }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Find user by email
    const { data: listData } = await supabase.auth.admin.listUsers();
    const matchedUser = listData?.users?.find(
      (u) => u.email?.toLowerCase() === cleanEmail
    );

    if (!matchedUser) {
      return NextResponse.json({
        error: "We couldn't find a Rooted account with that email. Ask them to sign up first at rootedhomeschoolapp.com",
      }, { status: 404 });
    }

    // Get family name
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", matchedUser.id)
      .maybeSingle();

    const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Gift a year of Rooted to ${familyName}`,
              description: "12 months of Rooted — unlimited memories, yearbook, and more.",
            },
            unit_amount: 5900,
          },
          quantity: 1,
        },
      ],
      success_url: "https://www.rootedhomeschoolapp.com/gift?success=true",
      cancel_url: "https://www.rootedhomeschoolapp.com/gift",
      metadata: {
        type: "family_gift",
        recipientUserId: matchedUser.id,
        inviteToken: "",
        gifterName: gifterName || "Someone special",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Gift checkout error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
