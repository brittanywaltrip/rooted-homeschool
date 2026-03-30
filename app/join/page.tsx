import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  if (ref) {
    const cookieStore = await cookies();
    cookieStore.set("rooted_ref", ref, {
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
      httpOnly: false, // readable by client JS
      sameSite: "lax",
    });
  }

  redirect("https://www.rootedhomeschoolapp.com");
}
