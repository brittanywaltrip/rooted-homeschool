/**
 * Shared email footer for all outgoing Resend emails.
 * Returns HTML string to append at the bottom of email bodies.
 */
export function emailFooterHtml(): string {
  return `<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af;">
  <p style="margin: 0;">You're receiving this because you have a Rooted account.</p>
  <p style="margin: 8px 0 0;">
    <a href="https://rootedhomeschoolapp.com/dashboard/settings" style="color: #6b7280; text-decoration: underline;">Manage email preferences</a>
  </p>
  <p style="margin: 8px 0 0;">Rooted &middot; hello@rootedhomeschoolapp.com &middot; 732 S 6th Street, STE N, Las Vegas, NV 89101</p>
</div>`;
}

/**
 * Plain-text version for text-only emails.
 */
export function emailFooterText(): string {
  return `\n---\nYou're receiving this because you have a Rooted account.\nManage preferences: https://rootedhomeschoolapp.com/dashboard/settings\nRooted · hello@rootedhomeschoolapp.com · 732 S 6th Street, STE N, Las Vegas, NV 89101`;
}
