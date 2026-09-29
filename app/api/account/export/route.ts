import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { selectAllRows } from "@/lib/supabase-all-rows";
import { listUserFiles, USER_SCOPED_BUCKETS } from "@/lib/storage-cleanup";
import archiver from "archiver";
import { PassThrough } from "stream";

// Only tables with an owner user_id and a stable id are listed here. Service
// role bypasses RLS, so every query MUST keep the owner filter. Global catalogs,
// billing/operational logs, and child tables without user_id need separate
// handling; they must never be fetched without an ownership predicate.
const FAMILY_TABLES = [
  "children", "memories", "lessons", "subjects", "curriculum_goals",
  "daily_reflections", "activities", "activity_logs", "appointments",
  "badges", "child_absences", "family_invites", "family_notifications",
  "lists", "list_items", "mailbox_progress", "monthly_reflections",
  "school_year_archives", "school_years", "transcript_courses",
  "transcript_settings", "vacation_blocks", "year_archive_certificates",
  "yearbook_content", "attendance", "child_ui_prefs", "earned_awards",
  "lesson_overrides", "schedule_items", "schedule_transactions",
  "subject_goals", "user_badges",
] as const;

type ExportRow = Record<string, unknown>;

async function readFamilyTable(table: (typeof FAMILY_TABLES)[number], userId: string) {
  try {
    return await selectAllRows<ExportRow>((from, to) =>
      supabaseAdmin.from(table).select("*").eq("user_id", userId).order("id").range(from, to),
    );
  } catch (error) {
    throw new Error(`Export read failed for ${table}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// These tables have no user_id; the IDs come exclusively from the authenticated
// family's already-filtered parent rows. Chunking keeps .in() URLs bounded.
async function readOwnedChildren(
  table: "appointment_exceptions" | "memory_comments" | "memory_reactions",
  parentColumn: "appointment_id" | "memory_id",
  parentRows: ExportRow[],
) {
  const ids = parentRows.map((row) => row.id).filter((id): id is string => typeof id === "string");
  const results: ExportRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    try {
      results.push(...await selectAllRows<ExportRow>((from, to) =>
        supabaseAdmin.from(table).select("*").in(parentColumn, chunk).order("id").range(from, to),
      ));
    } catch (error) {
      throw new Error(`Export read failed for ${table}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return results;
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

  // Never return a plausible-looking ZIP with empty files after a database
  // read error. Each table is paged with a stable unique order.
  let profileRows: ExportRow[];
  let tableRows: ExportRow[][];
  try {
    const [profileResult, ...familyResults] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", userId).single(),
      ...FAMILY_TABLES.map((table) => readFamilyTable(table, userId)),
    ]);
    if (profileResult.error || !profileResult.data) {
      throw new Error(`Export profile read failed: ${profileResult.error?.message ?? "profile missing"}`);
    }
    profileRows = [profileResult.data as ExportRow];
    tableRows = familyResults as ExportRow[][];
  } catch (error) {
    console.error("[export] database read failed for user", userId, error);
    return NextResponse.json({ error: "Export could not be completed. Please try again or contact support." }, { status: 503 });
  }

  const byTable = Object.fromEntries(FAMILY_TABLES.map((table, index) => [table, tableRows[index]])) as Record<(typeof FAMILY_TABLES)[number], ExportRow[]>;
  let relatedRows: Record<string, ExportRow[]>;
  try {
    const [exceptions, comments, reactions] = await Promise.all([
      readOwnedChildren("appointment_exceptions", "appointment_id", byTable.appointments),
      readOwnedChildren("memory_comments", "memory_id", byTable.memories),
      readOwnedChildren("memory_reactions", "memory_id", byTable.memories),
    ]);
    relatedRows = { appointment_exceptions: exceptions, memory_comments: comments, memory_reactions: reactions };
  } catch (error) {
    console.error("[export] related data read failed for user", userId, error);
    return NextResponse.json({ error: "Export could not be completed. Please try again or contact support." }, { status: 503 });
  }
  const memories = byTable.memories;
  const reflections = byTable.daily_reflections;

  // The family folder is authoritative even when a row contains an old signed
  // URL, or a file has no surviving row. An incomplete listing cannot support
  // a truthful "all files" export, so fail before creating the archive.
  const filesByBucket: Array<{ bucket: string; paths: string[] }> = [];
  for (const bucket of USER_SCOPED_BUCKETS) {
    const { paths, errors } = await listUserFiles(supabaseAdmin, bucket, userId);
    if (errors.length) {
      console.error("[export] file listing failed for user", userId, bucket, errors);
      return NextResponse.json({ error: "Export could not list all files. Please try again or contact support." }, { status: 503 });
    }
    filesByBucket.push({ bucket, paths });
  }

  const archive = archiver("zip", { zlib: { level: 5 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  archive.append(JSON.stringify(profileRows, null, 2), {
    name: "rooted-export/family.json",
  });
  for (const table of FAMILY_TABLES) {
    const filename = table === "curriculum_goals" ? "curriculum" : table === "daily_reflections" ? "reflections" : table;
    archive.append(JSON.stringify(byTable[table], null, 2), { name: `rooted-export/${filename}.json` });
  }
  for (const [table, rows] of Object.entries(relatedRows)) {
    archive.append(JSON.stringify(rows, null, 2), { name: `rooted-export/${table}.json` });
  }

  const missingLines: string[] = [];
  let fileCount = 0;
  for (const { bucket, paths } of filesByBucket) {
    for (const path of paths) {
      try {
        const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
        if (error || !data) {
          missingLines.push(`${bucket}/${path}: ${error?.message ?? "empty download body"}`);
          continue;
        }
        archive.append(Buffer.from(await data.arrayBuffer()), {
          name: `rooted-export/files/${bucket}/${encodeURIComponent(path.substring(userId.length + 1))}`,
        });
        fileCount++;
      } catch (error) {
        missingLines.push(`${bucket}/${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const memoriesCount = memories.length;
  const reflectionsCount = reflections.length;
  const dateStr = new Date().toISOString().split("T")[0];

  const readme = [
    `Rooted Homeschool data export`,
    `Generated: ${new Date().toISOString()}`,
    `User ID: ${userId}`,
    ``,
    `This archive includes the records and files listed below; it is not`,
    `a complete copy of every kind of data in Rooted. JSON files are raw`,
    `row dumps. Family-owned uploaded files are in /files/<bucket>/.`,
    ``,
    `Contents`,
    `  • family.json          your profile row`,
    ...FAMILY_TABLES.map((table) => `  • ${table === "curriculum_goals" ? "curriculum" : table === "daily_reflections" ? "reflections" : table}.json`),
    ...Object.keys(relatedRows).map((table) => `  • ${table}.json`),
    `  • files/               files found in the five family storage buckets`,
    `  • MISSING.txt          present only if one or more files failed`,
    `                          to download from storage; see that file`,
    `                          for details and email`,
    `                          hello@rootedhomeschoolapp.com so we can`,
    `                          investigate.`,
    ``,
    `Summary`,
    `  ${memoriesCount} memories`,
    `  ${fileCount} uploaded files exported`,
    `  ${missingLines.length} listed file(s) failed to download (see MISSING.txt)`,
    `  ${reflectionsCount} daily reflections`,
    ``,
  ].join("\n");
  archive.append(readme, { name: "rooted-export/README.txt" });

  if (missingLines.length > 0) {
    const missingContent = [
      `Rooted export: items that could not be downloaded`,
      `Generated: ${new Date().toISOString()}`,
      `User ID: ${userId}`,
      ``,
      `Each line is a listed file the server could not download from`,
      `Supabase Storage. The archive is incomplete.`,
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
    `[export] summary userId=${userId} memories=${memoriesCount} files=${fileCount} missing=${missingLines.length} reflections=${reflectionsCount}`,
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
      "X-Export-File-Count": String(fileCount),
      "X-Export-File-Missing": String(missingLines.length),
    },
  });
}
