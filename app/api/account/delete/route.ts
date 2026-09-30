import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resendClient, stripeClient } from "@/lib/api-clients";
import { emailFooterHtml } from "@/lib/email-footer";
import { captureSupabaseError } from "@/lib/sentry-error";
import { prepareDeletionBilling } from "@/lib/account-deletion-billing";
import {
  deleteAllUserStorage,
  summarize,
  unremovedCount,
} from "@/lib/storage-cleanup";

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

  let recordsDeletionStarted = false;
  try {
    // Fetch profile for Stripe customer ID before we delete anything
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, stripe_subscription_id, first_name, last_name, plan_type")
      .eq("id", userId)
      .single();

    // Billing must be confirmed BEFORE logging a deletion or removing files,
    // records, the billing mapping, or the login. Never swallow Stripe errors.
    try {
      await prepareDeletionBilling(profile, profileErr, () => stripeClient().subscriptions);
    } catch (billingErr) {
      captureSupabaseError("Account deletion: billing verification failed", billingErr, {
        tags: { route: "account_delete", phase: "billing_preflight" },
        extra: { user_id: userId },
      });
      return NextResponse.json({
        error: "We couldn't confirm that your billing is stopped, so we haven't deleted your account or family data. Some subscriptions may already have been canceled. Please try again or email hello@rootedhomeschoolapp.com for help.",
        dataDeleted: false,
      }, { status: 503 });
    }

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
      // Keep records and login so cleanup can be retried. Some files may
      // already be gone; never report this partial operation as a success.
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
      return NextResponse.json({
        error: "Your subscription billing was checked, but we couldn't finish removing your uploaded files. Some files may already have been removed. Your family records and sign-in are still available. Please retry deletion or email hello@rootedhomeschoolapp.com for help.",
        dataDeleted: false,
        deletionIncomplete: true,
      }, { status: 503 });
    } else {
      console.log(`[account/delete] storage swept for ${userId}: ${storageSummary}`);
    }

    // ── 0b. Log the deletion BEFORE removing database records ─────────────
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

    // Storage is verified empty before any family record or login is removed.
    recordsDeletionStarted = true;
    const deleteRows = async (table: string, column = "user_id") => {
      const { error } = await supabaseAdmin.from(table).delete().eq(column, userId);
      if (error) {
        captureSupabaseError("Account deletion: record removal failed", error, {
          tags: { route: "account_delete", phase: "record_delete", table },
          extra: { user_id: userId },
        });
        throw new Error("Family record removal failed");
      }
    };
    await deleteRows("family_notifications");

    // These owner-scoped tables have no auth/profile deletion cascade.
    // Remove them explicitly rather than leaving private reflections or
    // identifiable usage records behind after the login has disappeared.
    await deleteRows("daily_reflections");
    await deleteRows("child_ui_prefs");
    await deleteRows("app_events");

    await deleteRows("memories");

    // ── 3. Delete lessons ───────────────────────────────────────
    await deleteRows("lessons");

    // ── 4. Delete curriculum_goals ──────────────────────────────
    await deleteRows("curriculum_goals");

    // ── 5. Delete subjects ──────────────────────────────────────
    await deleteRows("subjects");

    // ── 6. Delete children ──────────────────────────────────────
    await deleteRows("children");

    // ── 7. Delete email_log ─────────────────────────────────────
    await deleteRows("email_log");

    // ── 7b. Delete vacation_blocks ──────────────────────────────
    // THIS IS THE STEP WHOSE ABSENCE BROKE ACCOUNT DELETION.
    //
    // History: vacation_blocks_user_id_fkey used to be ON DELETE
    // NO ACTION and prevented auth deletion; many other owner-linked
    // tables cascade on auth/profile removal. Tables without such a
    // cascade require explicit cleanup. Any user who had ever added one
    // break therefore hit a foreign-key violation at step 10:
    // supabaseAdmin.auth.admin.deleteUser failed, this route returned
    // 500, and the account was left in the worst possible state: all
    // their data wiped by steps 1-8, but their login still working.
    //
    // That is exactly what happened to a paying user on August 7,
    // 2026 (one vacation block, added May 3). She retried, got the
    // same 500, and signed back in on August 12 to an empty account.
    // 82 accounts held vacation blocks and would have failed the
    // same way. Other owner-scoped tables without a cascade are now explicitly
    // removed above; never assume auth deletion covers every public table.
    //
    // The constraint has since been fixed: verified against the live
    // database on August 18, 2026, vacation_blocks_user_id_fkey is
    // now ON DELETE CASCADE, so step 10 would sweep these rows on its
    // own. This app-level delete is retained as belt-and-braces. It is
    // idempotent, it costs one query, and it keeps the deletion
    // working even if the constraint is ever recreated without the
    // CASCADE. Do not remove it on the grounds that the FK now
    // handles it.
    await deleteRows("vacation_blocks");
    // child_absences cascades from auth.users and children too; deleted here
    // for the same belt-and-braces reason as vacation_blocks above.
    await deleteRows("child_absences");

    // ── 8. Delete profile ───────────────────────────────────────
    await deleteRows("profiles", "id");

    // Stripe subscriptions were canceled and checked before the wipe.

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
        await resendClient().emails.send({
          from: "Brittany from Rooted <hello@rootedhomeschoolapp.com>",
          to: userEmail,
          subject: "Your Rooted account has been deleted",
          html: `
            <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #2d2926;">
              <p style="font-size: 16px; line-height: 1.6;">Hi there,</p>
              <p style="font-size: 16px; line-height: 1.6;">
                Your Rooted sign-in has been removed, and the account deletion process has completed for your family records and uploaded files. Limited administrative records and backups may be retained as described in our privacy policy.
              </p>
              <p style="font-size: 16px; line-height: 1.6;">
                Thank you for being part of the Rooted family. If you ever want to come back, we'd love to have you. Just visit
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
      {
        error: recordsDeletionStarted
          ? "Your account deletion is incomplete. Some family records and uploaded files have been removed, but we couldn't finish. Email hello@rootedhomeschoolapp.com so we can complete it. Please don't press delete again."
          : "We couldn't finish account deletion. Some uploaded files may already have been removed. Your family records and sign-in have been kept. Please retry or email hello@rootedhomeschoolapp.com for help.",
        dataDeleted: recordsDeletionStarted,
        deletionIncomplete: true,
      },
      { status: 500 }
    );
  }
}
