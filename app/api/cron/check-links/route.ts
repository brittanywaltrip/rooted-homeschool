import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: resources } = await supabase
    .from("resources")
    .select("id, title, url");

  if (!resources?.length) {
    return NextResponse.json({ checked: 0, broken: 0 });
  }

  const broken: { title: string; url: string }[] = [];

  await Promise.all(
    resources.map(async (r) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(r.url, {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.status >= 400) {
          broken.push({ title: r.title, url: r.url });
        }
      } catch {
        broken.push({ title: r.title, url: r.url });
      }
    })
  );

  if (broken.length > 0) {
    await resend.emails.send({
      from: "Rooted <hello@rootedhomeschoolapp.com>",
      to: "garfieldbrittany@gmail.com",
      subject: `⚠️ ${broken.length} broken resource link${broken.length > 1 ? "s" : ""} found`,
      html: `
        <p>The weekly link check found ${broken.length} broken link${broken.length > 1 ? "s" : ""}:</p>
        <ul>
          ${broken.map((b) => `<li><strong>${b.title}</strong><br/><a href="${b.url}">${b.url}</a></li>`).join("")}
        </ul>
        <p>Fix these in your <a href="https://rootedhomeschoolapp.com/admin">admin panel</a>.</p>
      `,
    });
  }

  return NextResponse.json({ checked: resources.length, broken: broken.length });
}
