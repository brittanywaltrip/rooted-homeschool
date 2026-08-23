import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import Stripe from "stripe";
import { Resend } from "resend";
import { emailFooterHtml } from "@/lib/email-footer";
import { captureSupabaseError } from "@/lib/sentry-error";
import {
  deleteAllUserStorage,
  summarize,
  unremovedCount,
} from "@/lib/storage-cleanup";

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
      .select("stripe_customer_id, first_name, last_name, plan_type")
      .eq("id", userId)
      .single();

    // ── 0a. Idempotency guard ───────────────────────────────────
    // This route ran twice, 8 seconds apart, for a real user on
    // August 7, 2026. It was not a double-tap: the first call failed
    // at step 10 (see the vacation_blocks note there), the Settings
    // page surfaced the error and re-enabled the button, and she
    // pressed Delete again. Two deleted_accounts rows, two goodbye
    // emails, and a second full wipe of data that was already gone.
    //
    // A prior deleted_accounts row is the record of "this account has
    // already been logged as deleted". When one exists we skip the
    // forensic insert and the goodbye email, but still run the wipe
    // and the auth delete: every step below is idempotent (all deletes
    // are keyed on user_id), and a retry is precisely how a
    // half-finished deletion is meant to be repaired.
    //
    // This is a check-then-act, so two genuinely simultaneous requests
    // could still both read null and both insert. Closing that window
    // needs a unique index on deleted_accounts(user_id), which can't be
    // added until the existing duplicate pair is reconciled. Retries
    // seconds or minutes apart, the shape that actually happens, are
    // covered here.
    const { data: priorDeletion, error: priorErr } = await supabaseAdmin
      .from("deleted_accounts")
      .select("id, deleted_at")
      .eq("user_id", userId)
      .order("deleted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorErr) {
      // Don't block the deletion on a failed lookup; worst case we log a
      // second forensic row, which is the pre-existing behaviour.
      console.error("deleted_accounts idempotency lookup failed:", priorErr);
    }
    const alreadyLogged = Boolean(priorDeletion);
    if (alreadyLogged) {
      console.warn(
        `[account/delete] repeat deletion for ${userId}; first logged at ${priorDeletion?.deleted_at}. Skipping forensic log + goodbye email, re-running the wipe.`,
      );
    }

    // ── 0b. Log the deletion BEFORE wiping anything ─────────────
    // deleted_accounts is the permanent forensic trail (service role
    // only). If this insert fails we still proceed with the deletion,
    // but the failure is logged so it can be investigated.
    if (!alreadyLogged) {
      try {
        const [memCount, lessonCount, goalCount, childCount] = await Promise.all([
          supabaseAdmin.from("memories").select("id", { count: "exact", head: true }).eq("user_id", userId),
          supabaseAdmin.from("lessons").select("id", { count: "exact", head: true }).eq("user_id", userId),
          supabaseAdmin.from("curriculum_goals").select("id", { count: "exact", head: true }).eq("user_id", userId),
          supabaseAdmin.from("children").select("id", { count: "exact", head: true }).eq("user_id", userId),
        ]);
        const { error: logErr } = await supabaseAdmin.from("deleted_accounts").insert({
          user_id: userId,
          email: userEmail ?? null,
          first_name: profile?.first_name ?? null,
          last_name: profile?.last_name ?? null,
          plan_type: profile?.plan_type ?? null,
          account_created_at: user.created_at ?? null,
          memories_count: memCount.count ?? null,
          lessons_count: lessonCount.count ?? null,
          curriculum_goals_count: goalCount.count ?? null,
          children_count: childCount.count ?? null,
          source: "self_serve",
        });
        if (logErr) console.error("deleted_accounts log insert failed:", logErr);
      } catch (logErr) {
        console.error("deleted_accounts logging failed:", logErr);
      }
    }

    // ── 1. Delete family_notifications ──────────────────────────
    await supabaseAdmin
      .from("family_notifications")
      .delete()
      .eq("user_id", userId);

    // ── 2. Delete every uploaded file, then the memory rows ─────
    // DO NOT go back to parsing photo_url here.
    //
    // This step used to collect paths by matching each memories.photo_url
    // against one marker, "/object/public/memory-photos/". Storage went
    // private in April 2026, so most rows now hold SIGNED urls
    // (/object/sign/memory-photos/<path>?token=...) that the public marker
    // never matches: 647 of 1025 production photo_url values were
    // signed-style on August 22, 2026, so roughly two thirds of a deleting
    // family's photo files stayed in the bucket after their rows were gone.
    // The memories, yearbook-covers and year-certificates buckets were never
    // swept at all, and the family photo was removed by guessing three
    // filenames.
    //
    // deleteAllUserStorage asks storage what is actually in <userId>/ in
    // every user-scoped bucket, which is url-format-proof and also catches
    // files no row points at any more (replaced family photos, failed
    // uploads, photos whose memory row was deleted months ago).
    const storageResults = await deleteAllUserStorage(supabaseAdmin, userId);
    const leftover = unremovedCount(storageResults);
    const storageSummary = summarize(storageResults);
    const storageErrors = storageResults.flatMap((r) => r.errors);

    if (leftover > 0 || storageErrors.length > 0) {
      // Report it, but never fail the request: the user asked to be deleted
      // and the rest of the wipe still has to run.
      console.error(
        `[account/delete] storage sweep left files behind for ${userId}: ${storageSummary}`,
        storageErrors,
      );
      captureSupabaseError(
        "Account deletion: storage sweep left files behind",
        storageErrors[0] ?? { message: `${leftover} file(s) not removed` },
        {
          tags: { route: "account_delete", phase: "storage_sweep" },
          extra: {
            user_id: userId,
            leftover,
            summary: storageSummary,
            errors: storageErrors,
          },
        },
      );
    } else {
      console.log(`[account/delete] storage swept for ${userId}: ${storageSummary}`);
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

    // ── 7b. Delete vacation_blocks ──────────────────────────────
    // THIS IS THE STEP WHOSE ABSENCE BROKE ACCOUNT DELETION.
    //
    // History: vacation_blocks_user_id_fkey used to be ON DELETE
    // NO ACTION, the single exception among the public tables that
    // reference auth.users(id) (every other one is ON DELETE CASCADE
    // and gets swept by step 10). Any user who had ever added one
    // break therefore hit a foreign-key violation at step 10:
    // supabaseAdmin.auth.admin.deleteUser failed, this route returned
    // 500, and the account was left in the worst possible state: all
    // their data wiped by steps 1-8, but their login still working.
    //
    // That is exactly what happened to a paying user on August 7,
    // 2026 (one vacation block, added May 3). She retried, got the
    // same 500, and signed back in on August 12 to an empty account.
    // 82 accounts held vacation blocks and would have failed the
    // same way.
    //
    // The constraint has since been fixed: verified against the live
    // database on August 18, 2026, vacation_blocks_user_id_fkey is
    // now ON DELETE CASCADE, so step 10 would sweep these rows on its
    // own. This app-level delete is retained as belt-and-braces. It is
    // idempotent, it costs one query, and it keeps the deletion
    // working even if the constraint is ever recreated without the
    // CASCADE. Do not remove it on the grounds that the FK now
    // handles it.
    await supabaseAdmin.from("vacation_blocks").delete().eq("user_id", userId);

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
    // If this fails, everything above has already committed. The
    // account's data is gone and only the sign-in remains, so the
    // generic 500 the user used to see was actively misleading: it
    // reads as "nothing happened, try again" when in fact the wipe
    // is done and irreversible. Capture the real error (this is how
    // the vacation_blocks FK violation went unnoticed for months)
    // and tell the user the truth.
    const { error: deleteErr } =
      await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      captureSupabaseError("Account deletion: auth user delete failed", deleteErr, {
        tags: { route: "account_delete", phase: "auth_delete" },
        extra: { user_id: userId, already_logged: alreadyLogged },
      });
      return NextResponse.json(
        {
          error:
            "Your Rooted data has been deleted, but we couldn't remove your sign-in. Email hello@rootedhomeschoolapp.com and we'll finish it for you. Please don't press delete again.",
          dataDeleted: true,
        },
        { status: 500 }
      );
    }

    // ── Send goodbye email ──────────────────────────────────────
    // Skipped on a repeat run: the first one already sent this.
    if (userEmail && !alreadyLogged) {
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
