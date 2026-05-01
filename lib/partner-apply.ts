// Pure helpers for the public partner application flow. Extracted from
// app/api/partners/apply/route.ts so the body-to-row mapping is testable
// without booting the Supabase / Resend clients the route depends on.
//
// The form is now multi-channel (PayPal, Venmo, Zelle, Mercury (ACH),
// Other). The destination address still lands in partner_apps.paypal_email
// regardless of channel because renaming the column would be more migration
// churn than it's worth. The new payment_method column captures the
// channel; the admin notification email shows it inline.

export type PartnerApplyBody = {
  firstName?: string;
  lastName?: string;
  email?: string;
  hasRootedAccount?: boolean | null;
  rootedAccountEmail?: string | null;
  paymentMethod?: string;
  paymentAccount?: string;
  paypalEmail?: string;
  socialHandle?: string;
  audienceSize?: string;
  whyRooted?: string;
  platforms?: string[];
  platformSizes?: Record<string, string>;
  story?: string;
  whatToShare?: string;
  usedRooted?: string;
};

export type PartnerAppRow = {
  first_name: string;
  last_name: string;
  email: string;
  has_rooted_account: boolean;
  rooted_account_email: string | null;
  paypal_email: string;
  payment_method: string;
  social_handle: string;
  audience_size: string;
  why_rooted: string;
  platforms: string[];
  platform_sizes: Record<string, string>;
  about_journey: string;
  used_rooted: string;
};

export function buildPartnerAppRow(body: PartnerApplyBody): PartnerAppRow {
  const destinationAddress = body.paymentAccount || body.paypalEmail || "";
  const channel = body.paymentMethod || "PayPal";
  return {
    first_name: body.firstName ?? "",
    last_name: body.lastName ?? "",
    email: body.email ?? "",
    has_rooted_account: body.hasRootedAccount ?? false,
    rooted_account_email: body.rootedAccountEmail || null,
    paypal_email: destinationAddress,
    payment_method: channel,
    social_handle: body.socialHandle || "",
    audience_size: body.audienceSize || "",
    why_rooted: body.whyRooted || body.story || "",
    platforms: body.platforms ?? [],
    platform_sizes: body.platformSizes ?? {},
    about_journey: body.story || body.whyRooted || "",
    used_rooted: body.usedRooted ?? "",
  };
}
