import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import Stripe from "stripe";
import { Resend } from "resend";
import { emailFooterHtml } from "@/lib/email-footer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
});
const resend = new Resend(process.env.RESEND_API_KEY);

export async function DELETE(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;
  const userEmail = user.email;

  try {
    // Fetch profile for Stripe customer ID before we delete anything
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    // ── 1. Delete family_notifications ──────────────────────────
    await supabaseAdmin
      .from("family_notifications")
      .delete()
      .eq("user_id", userId);

    // ── 2. Delete memories + storage photos ─────────────────────
    const { data: memoriesData } = await supabaseAdmin
      .from("memories")
      .select("id, photo_url")
      .eq("user_id", userId);

    // Delete photos from storage in batches of 20
    if (memoriesData?.length) {
      const storagePaths: string[] = [];
      const marker = "/object/public/memory-photos/";

      for (const m of memoriesData) {
        if (!m.photo_url) continue;
        const idx = (m.photo_url as string).indexOf(marker);
        if (idx === -1) continue;
        let path = (m.photo_url as string).substring(idx + marker.length);
        const qIdx = path.indexOf("?");
        if (qIdx !== -1) path = path.substring(0, qIdx);
        storagePaths.push(path);
      }

      // Batch delete storage objects in groups of 20
      for (let i = 0; i < storagePaths.length; i += 20) {
        const batch = storagePaths.slice(i, i + 20);
        await supabaseAdmin.storage.from("memory-photos").remove(batch);
      }

      // Also delete family photo
      await supabaseAdmin.storage
        .from("family-photos")
        .remove([`${userId}/family.jpg`, `${userId}/family.png`, `${userId}/family.webp`]);
    }

    await supabaseAdmin.from("memories").delete().eq("user_id", userId);

    // ── 3. Delete lessons ───────────────────────────────────────
    await supabaseAdmin.from("lessons").delete().eq("user_id", userId);

    // ── 4. Delete curriculum_goals ──────────────────────────────
    await supabaseAdmin
      .from("curriculum_goals")
      .delete()
      .eq("user_id", userId);

    // ── 5. Delete subjects ──────────────────────────────────────
    await supabaseAdmin.from("subjects").delete().eq("user_id", userId);

    // ── 6. Delete children ──────────────────────────────────────
    await supabaseAdmin.from("children").delete().eq("user_id", userId);

    // ── 7. Delete email_log ─────────────────────────────────────
    await supabaseAdmin.from("email_log").delete().eq("user_id", userId);

    // ── 8. Delete profile ───────────────────────────────────────
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    // ── 9. Cancel Stripe subscription ───────────────────────────
    if (profile?.stripe_customer_id) {
      try {
        const subscriptions = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: "active",
        });
        for (const sub of subscriptions.data) {
          await stripe.subscriptions.cancel(sub.id);
        }
      } catch {
        // Non-critical — subscription may already be cancelled
      }
    }

    // ── 10. Delete auth user ────────────────────────────────────
    const { error: deleteErr } =
      await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      return NextResponse.json(
        { error: "Failed to delete auth account." },
        { status: 500 }
      );
    }

    // ── Send goodbye email ──────────────────────────────────────
    if (userEmail) {
      try {
        await resend.emails.send({
          from: "Brittany from Rooted <hello@rootedhomeschoolapp.com>",
          to: userEmail,
          subject: "Your Rooted account has been deleted",
          html: `
            <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #2d2926;">
              <p style="font-size: 16px; line-height: 1.6;">Hi there,</p>
              <p style="font-size: 16px; line-height: 1.6;">
                Your Rooted account and all associated data — memories, photos, lessons, and children's info — have been permanently deleted.
              </p>
              <p style="font-size: 16px; line-height: 1.6;">
                Thank you for being part of the Rooted family. If you ever want to come back, we'd love to have you — just visit
                <a href="https://rootedhomeschoolapp.com" style="color: #5c7f63;">rootedhomeschoolapp.com</a>.
              </p>
              <p style="font-size: 16px; line-height: 1.6;">
                Cheering you on,<br/>Brittany
              </p>
              ${emailFooterHtml()}
            </div>
          `,
        });
      } catch {
        // Non-critical — user is already deleted
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Account deletion error:", err);
    return NextResponse.json(
      { error: "Something went wrong during account deletion." },
      { status: 500 }
    );
  }
}
