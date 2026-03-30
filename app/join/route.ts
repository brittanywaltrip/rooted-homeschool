import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");

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
