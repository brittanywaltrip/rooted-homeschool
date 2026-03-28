import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});

// POST: Create a gift checkout session ($59 one-time)
export async function POST(req: NextRequest) {
  try {
    const { token, viewer_name } = await req.json();

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    // Verify invite
    const { data: invite } = await supabaseAdmin
      .from("family_invites")
      .select("user_id, viewer_name")
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    }

    // Get family name for checkout display
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name, first_name")
      .eq("id", invite.user_id)
      .maybeSingle();

    const familyName = profile?.display_name ?? profile?.first_name ?? "A Rooted family";
    const gifterName = viewer_name || invite.viewer_name || "A family member";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Gift a year of Rooted to ${familyName}`,
              description: "12 months of Rooted Homeschool — unlimited memories, yearbook, and more.",
            },
            unit_amount: 5900, // $59
          },
          quantity: 1,
        },
      ],
      success_url: `https://www.rootedhomeschoolapp.com/family/${token}?gift=success`,
      cancel_url: `https://www.rootedhomeschoolapp.com/family/${token}`,
      metadata: {
        type: "family_gift",
        recipientUserId: invite.user_id,
        inviteToken: token,
        gifterName,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Gift checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout" }, { status: 500 });
  }
}
