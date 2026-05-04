import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ schoolYearId: string }> }
) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { schoolYearId } = await params;
  const userId = user.id;

  const { data: schoolYear, error: syErr } = await supabaseAdmin
    .from("school_years")
    .select("id, name, start_date, end_date, status")
    .eq("id", schoolYearId)
    .eq("user_id", userId)
    .single();

  if (syErr || !schoolYear) {
    return NextResponse.json({ error: "School year not found" }, { status: 404 });
  }

  const { data: completedLessons, error: lessonsErr } = await supabaseAdmin
    .from("lessons")
    .select("minutes_spent")
    .eq("user_id", userId)
    .eq("school_year_id", schoolYearId)
    .eq("completed", true);

  if (lessonsErr) {
    return NextResponse.json({ error: lessonsErr.message }, { status: 500 });
  }

  const totalLessonsCompleted = completedLessons?.length ?? 0;
  const totalMinutes = (completedLessons ?? []).reduce(
    (sum, l) => sum + (l.minutes_spent ?? 0),
    0
  );

  const { data: goals, error: goalsErr } = await supabaseAdmin
    .from("curriculum_goals")
    .select("total_lessons")
    .eq("user_id", userId)
    .eq("school_year_id", schoolYearId);

  if (goalsErr) {
    return NextResponse.json({ error: goalsErr.message }, { status: 500 });
  }

  const totalLessonsPlanned = (goals ?? []).reduce(
    (sum, g) => sum + (g.total_lessons ?? 0),
    0
  );

  const { data: memoryRows, error: memErr } = await supabaseAdmin
    .from("memories")
    .select("id, type, photo_url, title")
    .eq("user_id", userId)
    .gte("date", schoolYear.start_date)
    .lte("date", schoolYear.end_date);

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  const memoryCountMap = new Map<string, number>();
  for (const m of memoryRows ?? []) {
    memoryCountMap.set(m.type, (memoryCountMap.get(m.type) ?? 0) + 1);
  }
  const memories = Array.from(memoryCountMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const endDateInclusive = `${schoolYear.end_date}T23:59:59.999Z`;
  const { data: badges, error: badgesErr } = await supabaseAdmin
    .from("badges")
    .select("badge_type, tier, earned_at")
    .eq("user_id", userId)
    .gte("earned_at", schoolYear.start_date)
    .lte("earned_at", endDateInclusive)
    .order("earned_at", { ascending: false });

  if (badgesErr) {
    return NextResponse.json({ error: badgesErr.message }, { status: 500 });
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .single();

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const { data: photos, error: photosErr } = await supabaseAdmin
    .from("memories")
    .select("id, photo_url, title, caption, date")
    .eq("user_id", userId)
    .eq("type", "photo")
    .gte("date", schoolYear.start_date)
    .lte("date", schoolYear.end_date)
    .order("date", { ascending: false });

  if (photosErr) {
    return NextResponse.json({ error: photosErr.message }, { status: 500 });
  }

  const { data: curriculumGoals, error: cgErr } = await supabaseAdmin
    .from("curriculum_goals")
    .select("id, subject_label, curriculum_name, icon_emoji")
    .eq("school_year_id", schoolYearId)
    .order("created_at", { ascending: true });

  if (cgErr) {
    return NextResponse.json({ error: cgErr.message }, { status: 500 });
  }

  const memoryIds = (memoryRows ?? []).map((m) => m.id);
  let totalReactions = 0;
  let totalComments = 0;
  let mostLovedMemory: {
    id: string;
    photo_url: string | null;
    type: string;
    title: string | null;
    reaction_count: number;
  } | null = null;
  let topComment: { body: string; commenter_name: string; created_at: string | null } | null = null;

  if (memoryIds.length > 0) {
    const [reactionsRes, commentsCountRes] = await Promise.all([
      supabaseAdmin
        .from("memory_reactions")
        .select("memory_id")
        .in("memory_id", memoryIds),
      supabaseAdmin
        .from("memory_comments")
        .select("memory_id", { count: "exact", head: true })
        .in("memory_id", memoryIds),
    ]);

    if (reactionsRes.error) {
      return NextResponse.json({ error: reactionsRes.error.message }, { status: 500 });
    }
    if (commentsCountRes.error) {
      return NextResponse.json({ error: commentsCountRes.error.message }, { status: 500 });
    }

    const reactions = reactionsRes.data ?? [];
    totalReactions = reactions.length;
    totalComments = commentsCountRes.count ?? 0;

    const reactionCountByMemory = new Map<string, number>();
    for (const r of reactions) {
      reactionCountByMemory.set(r.memory_id, (reactionCountByMemory.get(r.memory_id) ?? 0) + 1);
    }

    let topMemoryId: string | null = null;
    let topMemoryCount = 0;
    for (const [id, count] of reactionCountByMemory.entries()) {
      if (count > topMemoryCount) {
        topMemoryCount = count;
        topMemoryId = id;
      }
    }

    if (topMemoryId) {
      const mem = (memoryRows ?? []).find((m) => m.id === topMemoryId);
      if (mem) {
        mostLovedMemory = {
          id: mem.id,
          photo_url: mem.photo_url ?? null,
          type: mem.type,
          title: mem.title ?? null,
          reaction_count: topMemoryCount,
        };

        const { data: firstComment, error: firstCommentErr } = await supabaseAdmin
          .from("memory_comments")
          .select("body, commenter_name, created_at")
          .eq("memory_id", topMemoryId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstCommentErr) {
          return NextResponse.json({ error: firstCommentErr.message }, { status: 500 });
        }

        if (firstComment) {
          topComment = {
            body: firstComment.body,
            commenter_name: firstComment.commenter_name,
            created_at: firstComment.created_at,
          };
        }
      }
    }
  }

  const familyStats = {
    total_reactions: totalReactions,
    total_comments: totalComments,
    most_loved_memory: mostLovedMemory,
    top_comment: topComment,
  };

  return NextResponse.json({
    schoolYear,
    profile,
    totalLessonsCompleted,
    totalLessonsPlanned,
    totalMinutes,
    memories,
    badges: badges ?? [],
    photos: photos ?? [],
    curriculumGoals: curriculumGoals ?? [],
    familyStats,
  });
}
