import { NextRequest, NextResponse } from "next/server";
import { normalizeAffiliateCode } from "@/lib/referrals";

export async function GET(request: NextRequest) {
  // Normalize before storing so legacy aliases (e.g. MILKELYS → MICKEY)
  // are baked into the cookie at the moment of ingestion.
  const ref = normalizeAffiliateCode(request.nextUrl.searchParams.get("ref"));

  const response = NextResponse.redirect("https://www.rootedhomeschoolapp.com");

  if (ref) {
    response.cookies.set("rooted_ref", ref, {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
      httpOnly: false,
      sameSite: "lax",
    });
  }

  return response;
}
