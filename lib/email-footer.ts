// Relative + explicit extension so this module resolves under both the
// Next.js bundler and a raw `node` run, same convention as scheduler.ts.
import { buildUnsubscribeUrl } from "./email/list-unsubscribe.ts";

/**
 * Shared email footer for all outgoing Resend emails.
 *
 * `unsubscribeToken` is profiles.unsubscribe_token. Pass it on MARKETING mail
 * and the footer gains a direct one-click Unsubscribe link beside the
 * manage-preferences link, which is what CAN-SPAM requires and what the
 * settings link (behind a login) does not satisfy on its own. Omit it on
 * genuinely transactional mail, and on any email that already renders its own
 * unsubscribe link, so recipients never see two.
 *
 * Omitting it renders exactly the footer that shipped before this parameter
 * existed, so a profile with no token still gets a valid email.
 *
 * Inline styles and hardcoded colors only: email clients do not support CSS
 * variables (see the email rules in CLAUDE.md).
 */
export function emailFooterHtml(unsubscribeToken?: string | null): string {
  const unsubscribeLink = unsubscribeToken
    ? `
    &nbsp;&middot;&nbsp;
    <a href="${buildUnsubscribeUrl(unsubscribeToken)}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a>`
    : "";
  return `<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af;">
  <p style="margin: 0;">You're receiving this because you have a Rooted account.</p>
  <p style="margin: 8px 0 0;">
    <a href="https://rootedhomeschoolapp.com/dashboard/settings" style="color: #6b7280; text-decoration: underline;">Manage email preferences</a>${unsubscribeLink}
  </p>
  <p style="margin: 8px 0 0;">Rooted &middot; hello@rootedhomeschoolapp.com &middot; 732 S 6th Street, STE N, Las Vegas, NV 89101</p>
</div>`;
}

/**
 * Plain-text version for text-only emails. Same token contract as above.
 */
export function emailFooterText(unsubscribeToken?: string | null): string {
  const unsubscribeLine = unsubscribeToken
    ? `\nUnsubscribe: ${buildUnsubscribeUrl(unsubscribeToken)}`
    : "";
  return `\n---\nYou're receiving this because you have a Rooted account.\nManage preferences: https://rootedhomeschoolapp.com/dashboard/settings${unsubscribeLine}\nRooted \u00b7 hello@rootedhomeschoolapp.com \u00b7 732 S 6th Street, STE N, Las Vegas, NV 89101`;
}
