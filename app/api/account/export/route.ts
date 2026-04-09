import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import archiver from "archiver";
import { PassThrough } from "stream";

export async function POST(req: NextRequest) {
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

  // Fetch all user data in parallel
  const [profiles, children, memories, lessons, subjects, curriculum] =
    await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", userId),
      supabaseAdmin.from("children").select("*").eq("user_id", userId),
      supabaseAdmin.from("memories").select("*").eq("user_id", userId),
      supabaseAdmin.from("lessons").select("*").eq("user_id", userId),
      supabaseAdmin.from("subjects").select("*").eq("user_id", userId),
      supabaseAdmin
        .from("curriculum_goals")
        .select("*")
        .eq("user_id", userId),
    ]);

  // Build the ZIP
  const archive = archiver("zip", { zlib: { level: 5 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  archive.append(JSON.stringify(profiles.data ?? [], null, 2), {
    name: "rooted-export/family.json",
  });
  archive.append(JSON.stringify(children.data ?? [], null, 2), {
    name: "rooted-export/children.json",
  });
  archive.append(JSON.stringify(memories.data ?? [], null, 2), {
    name: "rooted-export/memories.json",
  });
  archive.append(JSON.stringify(lessons.data ?? [], null, 2), {
    name: "rooted-export/lessons.json",
  });
  archive.append(JSON.stringify(subjects.data ?? [], null, 2), {
    name: "rooted-export/subjects.json",
  });
  archive.append(JSON.stringify(curriculum.data ?? [], null, 2), {
    name: "rooted-export/curriculum.json",
  });

  // Fetch and include photos
  const memoriesWithPhotos = (memories.data ?? []).filter(
    (m: { photo_url?: string | null }) => m.photo_url
  );

  for (const memory of memoriesWithPhotos) {
    try {
      const url = memory.photo_url as string;
      // Extract storage path from public URL: ...object/public/memory-photos/{path}
      const marker = "/object/public/memory-photos/";
      const idx = url.indexOf(marker);
      if (idx === -1) continue;

      let storagePath = url.substring(idx + marker.length);
      // Remove cache-bust query string
      const qIdx = storagePath.indexOf("?");
      if (qIdx !== -1) storagePath = storagePath.substring(0, qIdx);

      const { data: fileData, error: fileErr } = await supabaseAdmin.storage
        .from("memory-photos")
        .download(storagePath);

      if (fileErr || !fileData) continue;

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const ext = storagePath.split(".").pop() ?? "jpg";
      archive.append(buffer, {
        name: `rooted-export/photos/${memory.id}.${ext}`,
      });
    } catch {
      // Skip failed photo downloads silently
    }
  }

  archive.finalize();

  // Log the export
  try {
    await supabaseAdmin.from("email_log").insert({
      user_id: userId,
      email_type: "data_export",
    });
  } catch {
    // non-critical
  }

  const dateStr = new Date().toISOString().split("T")[0];

  // Convert Node stream to Web ReadableStream
  const readable = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="rooted-memories-${dateStr}.zip"`,
    },
  });
}
