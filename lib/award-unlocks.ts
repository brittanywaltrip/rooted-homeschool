import { supabase } from "@/lib/supabase";

type CertificateType =
  | "graduation"
  | "subject_mastery"
  | "reading_achievement"
  | "weekly_win"
  | "streak_award"
  | "first_day"
  | "bookworm"
  | "explorer"
  | "artist"
  | "daily_champion"
  | "you_started"
  | "you_captured_it"
  | "you_read_together"
  | "you_took_them_there"
  | "one_whole_week"
  | "one_whole_month"
  | "100_days_strong"
  | "memory_keeper"
  | "story_keeper"
  | "you_did_that"
  | "founding_homeschooler"
  | "custom";

export interface AppData {
  children: { id: string; name: string }[];
  completedLessons: { child_id: string; date: string; scheduled_date?: string }[];
  memories: { id: string; type: string; child_id: string | null; title: string | null; date: string }[];
  totalSchoolDays: number;
  profile: { display_name: string; created_at?: string };
  academyName: string;
}

export interface NewAward {
  award_type: CertificateType;
  child_id: string | null;
  certificate_data: Record<string, string>;
  label: string;
  isEducator: boolean;
}

export interface EarnedAward {
  id: string;
  user_id: string;
  award_type: string;
  child_id: string | null;
  earned_at: string;
  certificate_data: Record<string, string> | null;
  downloaded_at: string | null;
}

export const AWARD_LABELS: Record<string, { emoji: string; label: string; isEducator: boolean }> = {
  first_day: { emoji: "🌅", label: "First Day of School", isEducator: false },
  bookworm: { emoji: "📚", label: "Bookworm Award", isEducator: false },
  reading_achievement: { emoji: "📖", label: "Reading Achievement", isEducator: false },
  explorer: { emoji: "🗺️", label: "Explorer Award", isEducator: false },
  artist: { emoji: "🎨", label: "Artist Award", isEducator: false },
  daily_champion: { emoji: "🏆", label: "Daily Champion", isEducator: false },
  streak_award: { emoji: "🔥", label: "30-Day Streak", isEducator: false },
  you_started: { emoji: "💛", label: "You Started", isEducator: true },
  you_captured_it: { emoji: "📸", label: "You Captured It", isEducator: true },
  you_read_together: { emoji: "📕", label: "You Read Together", isEducator: true },
  you_took_them_there: { emoji: "🚌", label: "You Took Them There", isEducator: true },
  one_whole_week: { emoji: "📅", label: "One Whole Week", isEducator: true },
  one_whole_month: { emoji: "🗓️", label: "One Whole Month", isEducator: true },
  "100_days_strong": { emoji: "💯", label: "100 Days Strong", isEducator: true },
  memory_keeper: { emoji: "🧡", label: "Memory Keeper", isEducator: true },
  story_keeper: { emoji: "📓", label: "Story Keeper", isEducator: true },
  founding_homeschooler: { emoji: "🌿", label: "Founding Homeschooler", isEducator: true },
  graduation: { emoji: "🎓", label: "Graduation Certificate", isEducator: false },
  subject_mastery: { emoji: "⭐", label: "Subject Mastery", isEducator: false },
  weekly_win: { emoji: "🎉", label: "Weekly Win", isEducator: false },
  you_did_that: { emoji: "✨", label: "You Did That", isEducator: true },
  custom: { emoji: "🏅", label: "Custom Award", isEducator: false },
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentYearRange(): string {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() < 7 ? `${y - 1}-${y}` : `${y}-${y + 1}`;
}

function computeStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const unique = Array.from(new Set(dates)).sort().reverse();
  const today = todayStr();

  let streak = 0;
  let current = new Date(today);

  for (const dateStr of unique) {
    const d = new Date(dateStr);
    const diffMs = current.getTime() - d.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0 || diffDays === 1) {
      streak++;
      current = d;
    } else {
      break;
    }
  }

  return streak;
}

export async function checkAndGrantAwards(userId: string, appData: AppData): Promise<NewAward[]> {
  const { children, completedLessons, memories, totalSchoolDays, profile, academyName } = appData;
  const today = todayStr();

  // Fetch all existing earned awards for this user
  const { data: existingData } = await supabase
    .from("earned_awards")
    .select("*")
    .eq("user_id", userId);

  const existing: EarnedAward[] = existingData ?? [];

  const pendingUpserts: {
    user_id: string;
    award_type: string;
    child_id: string | null;
    certificate_data: Record<string, string>;
    earned_at: string;
  }[] = [];

  const newAwards: NewAward[] = [];

  function hasExisting(award_type: string, child_id: string | null): boolean {
    return existing.some(
      (e) => e.award_type === award_type && e.child_id === child_id
    );
  }

  function addAward(
    award_type: CertificateType,
    child_id: string | null,
    certificate_data: Record<string, string>
  ) {
    if (hasExisting(award_type, child_id)) return;

    const meta = AWARD_LABELS[award_type];
    newAwards.push({
      award_type,
      child_id,
      certificate_data,
      label: meta?.label ?? award_type,
      isEducator: meta?.isEducator ?? false,
    });

    pendingUpserts.push({
      user_id: userId,
      award_type,
      child_id,
      certificate_data,
      earned_at: new Date().toISOString(),
    });
  }

  // --- Per-child awards ---
  for (const child of children) {
    const childLessons = completedLessons.filter((l) => l.child_id === child.id);
    const childMemories = memories.filter((m) => m.child_id === child.id);
    const childBooks = childMemories.filter((m) => m.type === "book");
    const childFieldTrips = childMemories.filter((m) => m.type === "field_trip");
    const childDrawings = childMemories.filter((m) => m.type === "drawing");

    // FIRST_DAY
    if (childLessons.length >= 1) {
      const sortedLessons = [...childLessons].sort((a, b) => a.date.localeCompare(b.date));
      addAward("first_day", child.id, {
        childName: child.name,
        academyName,
        date: sortedLessons[0].date,
      });
    }

    // BOOKWORM
    if (childBooks.length >= 1) {
      const sortedBooks = [...childBooks].sort((a, b) => a.date.localeCompare(b.date));
      const firstBook = sortedBooks[0];
      addAward("bookworm", child.id, {
        childName: child.name,
        bookTitle: firstBook.title ?? "a book",
        academyName,
        date: firstBook.date,
      });
    }

    // READING_ACHIEVEMENT (most recent book)
    if (childBooks.length >= 1) {
      const sortedBooks = [...childBooks].sort((a, b) => b.date.localeCompare(a.date));
      const latestBook = sortedBooks[0];
      addAward("reading_achievement", child.id, {
        childName: child.name,
        bookTitle: latestBook.title ?? "a book",
        academyName,
        date: latestBook.date,
      });
    }

    // EXPLORER
    if (childFieldTrips.length >= 1) {
      const sortedTrips = [...childFieldTrips].sort((a, b) => a.date.localeCompare(b.date));
      addAward("explorer", child.id, {
        childName: child.name,
        academyName,
        date: sortedTrips[0].date,
      });
    }

    // ARTIST
    if (childDrawings.length >= 1) {
      const sortedDrawings = [...childDrawings].sort((a, b) => a.date.localeCompare(b.date));
      addAward("artist", child.id, {
        childName: child.name,
        academyName,
        date: sortedDrawings[0].date,
      });
    }

    // DAILY_CHAMPION
    if (childLessons.length >= 1) {
      const dateGroups: Record<string, number> = {};
      for (const l of childLessons) {
        dateGroups[l.date] = (dateGroups[l.date] ?? 0) + 1;
      }
      const firstDate = Object.keys(dateGroups).sort()[0];
      if (firstDate) {
        addAward("daily_champion", child.id, {
          childName: child.name,
          date: firstDate,
          academyName,
        });
      }
    }

    // STREAK_AWARD (>= 30 days)
    const lessonDates = childLessons.map((l) => l.date);
    const streak = computeStreak(lessonDates);
    if (streak >= 30) {
      addAward("streak_award", child.id, {
        childName: child.name,
        streakDays: String(streak),
        academyName,
        schoolYear: currentYearRange(),
        date: today,
      });
    }
  }

  // --- Family-level educator awards (child_id = null) ---

  const sortedAllLessons = [...completedLessons].sort((a, b) => a.date.localeCompare(b.date));
  const sortedAllMemories = [...memories].sort((a, b) => a.date.localeCompare(b.date));
  const allBooks = memories.filter((m) => m.type === "book");
  const allFieldTrips = memories.filter((m) => m.type === "field_trip");
  const educatorName = profile.display_name;

  // YOU_STARTED
  if (completedLessons.length >= 1) {
    addAward("you_started", null, {
      educatorName,
      academyName,
      date: sortedAllLessons[0].date,
    });
  }

  // YOU_CAPTURED_IT
  if (memories.length >= 1) {
    addAward("you_captured_it", null, {
      educatorName,
      academyName,
      date: sortedAllMemories[0].date,
    });
  }

  // YOU_READ_TOGETHER
  if (allBooks.length >= 1) {
    const sortedBooks = [...allBooks].sort((a, b) => a.date.localeCompare(b.date));
    addAward("you_read_together", null, {
      educatorName,
      bookTitle: sortedBooks[0].title ?? "a book",
      academyName,
      date: sortedBooks[0].date,
    });
  }

  // YOU_TOOK_THEM_THERE
  if (allFieldTrips.length >= 1) {
    const sortedTrips = [...allFieldTrips].sort((a, b) => a.date.localeCompare(b.date));
    addAward("you_took_them_there", null, {
      educatorName,
      academyName,
      date: sortedTrips[0].date,
    });
  }

  // ONE_WHOLE_WEEK
  if (totalSchoolDays >= 7) {
    addAward("one_whole_week", null, {
      educatorName,
      academyName,
      date: today,
    });
  }

  // ONE_WHOLE_MONTH
  if (totalSchoolDays >= 30) {
    addAward("one_whole_month", null, {
      educatorName,
      academyName,
      date: today,
    });
  }

  // 100_DAYS_STRONG
  if (totalSchoolDays >= 100) {
    addAward("100_days_strong", null, {
      educatorName,
      totalDays: String(totalSchoolDays),
      academyName,
      date: today,
    });
  }

  // MEMORY_KEEPER
  if (memories.length >= 50) {
    addAward("memory_keeper", null, {
      educatorName,
      memoryCount: String(memories.length),
      academyName,
      date: today,
    });
  }

  // STORY_KEEPER
  if (memories.length >= 100) {
    addAward("story_keeper", null, {
      educatorName,
      memoryCount: String(memories.length),
      academyName,
      date: today,
    });
  }

  // FOUNDING_HOMESCHOOLER (always granted)
  addAward("founding_homeschooler", null, {
    educatorName,
    academyName,
    joinDate: profile.created_at ?? today,
  });

  // Upsert all newly earned awards
  if (pendingUpserts.length > 0) {
    await supabase
      .from("earned_awards")
      .upsert(pendingUpserts, { onConflict: "user_id,award_type,child_id", ignoreDuplicates: true });
  }

  return newAwards;
}
