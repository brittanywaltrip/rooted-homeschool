import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkAndIncrementAIUsage } from "@/lib/ai-usage";

export interface YearStats {
  familyName: string;
  childrenNames: string[];
  year: number;
  totalLessons: number;
  totalHours: number;
  booksRead: number;
  subjectsCovered: string[];
  photosUploaded: number;
  projectsCompleted: number;
  memoryBooksLogged: number;
  reflectionsWritten: number;
  topSubjects: { name: string; hours: number }[];
  recentMemoryTitles: string[];
}

export interface YearReviewResponse {
  narrative: string;   // 3–4 warm paragraphs
  highlights: string[]; // 5–7 bullet-style highlights
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your-anthropic-api-key-here") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Add it to .env.local on Vercel." },
      { status: 500 }
    );
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .maybeSingle();

  const isPro = profile?.subscription_status === "active";

  const usage = await checkAndIncrementAIUsage(user.id, isPro);
  if (!usage.allowed) {
    const message = isPro
      ? `You've reached your 50 AI generations for this month. Your limit resets on ${usage.resetDate}.`
      : "AI features are available on Pro. Upgrade for $39/year — less than one curriculum book. 🌿";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const stats: YearStats = await req.json();

  const client = new Anthropic({ apiKey });

  const childrenPhrase =
    stats.childrenNames.length === 0
      ? "your children"
      : stats.childrenNames.length === 1
      ? stats.childrenNames[0]
      : stats.childrenNames.slice(0, -1).join(", ") +
        " and " +
        stats.childrenNames[stats.childrenNames.length - 1];

  const topSubjectsText =
    stats.topSubjects.length > 0
      ? stats.topSubjects
          .map((s) => `${s.name} (${s.hours.toFixed(1)} hrs)`)
          .join(", ")
      : "a variety of subjects";

  const memoriesContext =
    stats.recentMemoryTitles.length > 0
      ? `\nSome of the memories and moments logged this year include: ${stats.recentMemoryTitles.slice(0, 12).join("; ")}.`
      : "";

  const prompt = `You are writing a warm, celebratory, emotionally resonant Year in Review for a homeschool family.

Family: ${stats.familyName || "This family"}
Children: ${childrenPhrase}
Year: ${stats.year}

Here are their accomplishments this year:
- Completed lessons: ${stats.totalLessons}
- Hours of learning logged: ${stats.totalHours.toFixed(1)}
- Books read: ${stats.booksRead}
- Subjects explored: ${stats.subjectsCovered.length > 0 ? stats.subjectsCovered.join(", ") : "various subjects"}
- Top subjects by hours: ${topSubjectsText}
- Photos captured: ${stats.photosUploaded}
- Projects completed: ${stats.projectsCompleted}
- Memory books logged: ${stats.memoryBooksLogged}
- Daily reflections written: ${stats.reflectionsWritten}${memoriesContext}

Write two things:

1. NARRATIVE: A beautiful, warm 3-paragraph story of this family's homeschool year. Make it personal, emotional, and celebratory — like a letter they'll want to frame and share with grandparents. Reference their actual numbers and subjects naturally in the prose. Acknowledge the effort, the love, and the growth. End with a hopeful, encouraging look toward the next year. Do NOT use generic homeschool clichés. Make it feel real and specific to this family.

2. HIGHLIGHTS: A list of exactly 6 milestone highlights from the year — short, specific, celebratory phrases (no more than 15 words each). These should capture the most impressive or heartwarming achievements. Include specific numbers where they matter.

Format your response EXACTLY as JSON like this:
{
  "narrative": "paragraph one\\n\\nparagraph two\\n\\nparagraph three",
  "highlights": [
    "highlight one",
    "highlight two",
    "highlight three",
    "highlight four",
    "highlight five",
    "highlight six"
  ]
}

Only output valid JSON. No markdown fences, no preamble.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Strip any accidental markdown fences
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed: YearReviewResponse = JSON.parse(cleaned);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Year in Review API error:", err);
    return NextResponse.json(
      { error: "Failed to generate review. Please try again." },
      { status: 500 }
    );
  }
}
