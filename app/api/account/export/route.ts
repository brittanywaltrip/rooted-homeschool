import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import archiver from "archiver";
import { PassThrough } from "stream";

// Supabase public-bucket URLs can appear in several shapes depending on
// whether they came from getPublicUrl() today vs older code paths. Parse
// the path that follows a known marker for the given bucket and strip any
// cache-busting query string. Returns null when the URL doesn't reference
// the target bucket — the caller should flag this so we notice stale data.
function extractStoragePath(url: string, bucket: string): string | null {
  if (!url) return null;
  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/${bucket}/`,
    `/object/public/${bucket}/`,
    `/object/${bucket}/`,
  ];
  for (const marker of markers) {
    const idx = url.indexOf(marker);
    if (idx === -1) continue;
    let path = url.substring(idx + marker.length);
    const qIdx = path.indexOf("?");
    if (qIdx !== -1) path = path.substring(0, qIdx);
    return path;
  }
  return null;
}

function extFromPath(path: string, fallback = "jpg"): string {
  const lastSlash = path.lastIndexOf("/");
  const tail = lastSlash === -1 ? path : path.substring(lastSlash + 1);
  const dotIdx = tail.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === tail.length - 1) return fallback;
  return tail.substring(dotIdx + 1).toLowerCase();
}

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
  console.log("[export] starting export for user", userId);

  // Fetch all user data in parallel
  const [profiles, children, memories, lessons, subjects, curriculum, reflections] =
    await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", userId),
      supabaseAdmin.from("children").select("*").eq("user_id", userId),
      supabaseAdmin.from("memories").select("*").eq("user_id", userId),
      supabaseAdmin.from("lessons").select("*").eq("user_id", userId),
      supabaseAdmin.from("subjects").select("*").eq("user_id", userId),
      supabaseAdmin.from("curriculum_goals").select("*").eq("user_id", userId),
      supabaseAdmin.from("daily_reflections").select("*").eq("user_id", userId),
    ]);

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
  archive.append(JSON.stringify(reflections.data ?? [], null, 2), {
    name: "rooted-export/reflections.json",
  });

  const memoriesWithPhotos = (memories.data ?? []).filter(
    (m: { photo_url?: string | null }) => m.photo_url,
  );

  const missingLines: string[] = [];
  let photoCount = 0;
  let photoMissing = 0;

  for (const memory of memoriesWithPhotos) {
    const url = memory.photo_url as string;
    const storagePath = extractStoragePath(url, "memory-photos");

    if (!storagePath) {
      photoMissing++;
      const reason = `url did not match memory-photos bucket (url=${url.slice(0, 120)}…)`;
      console.log(
        `[export] photo ${memory.id} → path="<unparseable>" → result=FAIL: ${reason}`,
      );
      missingLines.push(
        `memory ${memory.id} (date=${memory.date ?? "?"}): ${reason}`,
      );
      continue;
    }

    try {
      const { data: fileData, error: fileErr } = await supabaseAdmin.storage
        .from("memory-photos")
        .download(storagePath);

      console.log(
        `[export] photo ${memory.id} → path="${storagePath}" → result=${
          fileData ? "OK" : `FAIL: ${fileErr?.message ?? "empty download body"}`
        }`,
      );

      if (!fileData) {
        photoMissing++;
        missingLines.push(
          `memory ${memory.id} (date=${memory.date ?? "?"}, path=${storagePath}): ${fileErr?.message ?? "empty download body"}`,
        );
        continue;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const ext = extFromPath(storagePath, "jpg");
      archive.append(buffer, {
        name: `rooted-export/photos/${memory.id}.${ext}`,
      });
      photoCount++;
    } catch (err) {
      photoMissing++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        `[export] photo ${memory.id} → path="${storagePath}" → result=FAIL: ${message}`,
      );
      missingLines.push(
        `memory ${memory.id} (date=${memory.date ?? "?"}, path=${storagePath}): ${message}`,
      );
    }
  }

  // Family photo — separate bucket (family-photos).
  const profile = (profiles.data ?? [])[0] as { family_photo_url?: string | null } | undefined;
  const familyPhotoUrl = profile?.family_photo_url ?? null;
  let familyPhotoIncluded = false;
  if (familyPhotoUrl) {
    const storagePath = extractStoragePath(familyPhotoUrl, "family-photos");
    if (!storagePath) {
      const reason = `url did not match family-photos bucket (url=${familyPhotoUrl.slice(0, 120)}…)`;
      console.log(`[export] family-photo → path="<unparseable>" → result=FAIL: ${reason}`);
      missingLines.push(`family photo: ${reason}`);
    } else {
      try {
        const { data: fileData, error: fileErr } = await supabaseAdmin.storage
          .from("family-photos")
          .download(storagePath);
        console.log(
          `[export] family-photo → path="${storagePath}" → result=${
            fileData ? "OK" : `FAIL: ${fileErr?.message ?? "empty download body"}`
          }`,
        );
        if (fileData) {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const ext = extFromPath(storagePath, "jpg");
          archive.append(buffer, { name: `rooted-export/family-photo.${ext}` });
          familyPhotoIncluded = true;
        } else {
          missingLines.push(
            `family photo (path=${storagePath}): ${fileErr?.message ?? "empty download body"}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[export] family-photo → path="${storagePath}" → result=FAIL: ${message}`);
        missingLines.push(`family photo (path=${storagePath}): ${message}`);
      }
    }
  }

  const memoriesCount = (memories.data ?? []).length;
  const memoriesWithPhotoCount = memoriesWithPhotos.length;
  const reflectionsCount = (reflections.data ?? []).length;
  const dateStr = new Date().toISOString().split("T")[0];

  const readme = [
    `Rooted Homeschool — data export`,
    `Generated: ${new Date().toISOString()}`,
    `User ID: ${userId}`,
    ``,
    `This archive is your complete personal copy of everything Rooted has`,
    `stored on your behalf. All JSON files are raw row dumps; photos live`,
    `in /photos and are named by memory id. Your family portrait is at`,
    `/family-photo.* (if you uploaded one).`,
    ``,
    `Contents`,
    `  • family.json        — your profile row(s)`,
    `  • children.json      — children list (active + archived)`,
    `  • memories.json      — every memory row with metadata`,
    `  • lessons.json       — every lesson row with completion + notes`,
    `  • subjects.json      — subjects you've defined`,
    `  • curriculum.json    — curriculum goals`,
    `  • reflections.json   — daily reflections`,
    `  • photos/            — memory photos, named {memory_id}.{ext}`,
    `  • family-photo.*     — family portrait (if set)`,
    `  • MISSING.txt        — present only if one or more files failed`,
    `                          to download from storage; see that file`,
    `                          for details and email`,
    `                          hello@rootedhomeschoolapp.com so we can`,
    `                          investigate.`,
    ``,
    `Summary`,
    `  ${memoriesCount} memories (${memoriesWithPhotoCount} with photos)`,
    `  ${photoCount} photos successfully exported`,
    `  ${photoMissing} photo${photoMissing === 1 ? "" : "s"} missing (see MISSING.txt)`,
    `  ${reflectionsCount} daily reflections`,
    `  family photo: ${familyPhotoIncluded ? "yes" : familyPhotoUrl ? "no (failed — see MISSING.txt)" : "not set"}`,
    ``,
  ].join("\n");
  archive.append(readme, { name: "rooted-export/README.txt" });

  if (missingLines.length > 0) {
    const missingContent = [
      `Rooted export — items that could not be downloaded`,
      `Generated: ${new Date().toISOString()}`,
      `User ID: ${userId}`,
      ``,
      `Each line is one item the server couldn't fetch from Supabase`,
      `Storage. Reasons are usually: the file was deleted in storage but`,
      `the DB row still references it, the url shape changed and our`,
      `parser didn't match, or Storage returned an error.`,
      ``,
      `Please email this list to hello@rootedhomeschoolapp.com so we can`,
      `investigate and either recover the files or fix the broken`,
      `reference.`,
      ``,
      ...missingLines,
      ``,
    ].join("\n");
    archive.append(missingContent, { name: "rooted-export/MISSING.txt" });
  }

  console.log(
    `[export] summary userId=${userId} memories=${memoriesCount} photoOK=${photoCount} photoMissing=${photoMissing} reflections=${reflectionsCount} familyPhoto=${familyPhotoIncluded ? "yes" : "no"}`,
  );

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
      "X-Export-Memory-Count": String(memoriesCount),
      "X-Export-Photo-Count": String(photoCount),
      "X-Export-Photo-Missing": String(photoMissing),
    },
  });
}
