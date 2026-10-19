import { GROWTH_STAGES } from "../lib/garden-stages.ts";

export type FeatureId =
  | "memories" | "today" | "plan" | "garden" | "printables"
  | "yearbook" | "reports" | "transcripts" | "years" | "resources";

type TourFeature = {
  id: FeatureId;
  label: string;
  emoji: string;
  location: string;
  headline: string;
  sub: string;
  bullets: string[];
  note: string;
};

// Keep the public tour tied to the same growth ladder as Garden and Years.
const finalStage = GROWTH_STAGES[GROWTH_STAGES.length - 1];

export const TOUR_FEATURES: TourFeature[] = [
  {
    id: "memories",
    label: "Memories",
    emoji: "📸",
    location: "Memories",
    headline: "Hold onto the little things",
    sub: "The field trips, the books they loved, the thing they said that made you laugh. Keep your family's learning story together.",
    bullets: [
      "Save photos, quotes, wins, books, field trips, and artwork",
      "Find a memory by child or type, or search for something you remember",
      "Share selected memories with family through a private viewer link",
    ],
    note: "Family sharing requires Rooted+ or an active trial. You choose which memories stay private.",
  },
  {
    id: "today",
    label: "Today",
    emoji: "☀️",
    location: "Today",
    headline: "A place to start your day",
    sub: "See what's on the plan, keep track of the learning you do, and save a moment before you forget it.",
    bullets: [
      "See today's lessons and activities, organized for your family",
      "Check off a lesson and confirm the minutes you spent on it",
      "Capture a photo, book, field trip, or win as your day unfolds",
    ],
    note: "The minutes you log become part of your learning record.",
  },
  {
    id: "plan",
    label: "Plan",
    emoji: "📅",
    location: "Plan",
    headline: "Make room for your kind of week",
    sub: "Use a curriculum schedule or choose the lessons yourself. There's room for both.",
    bullets: [
      "Build a curriculum schedule from your school days, lessons a day, and where you are in the book",
      "Use Plan this week to add your own lessons to the days you choose",
      "Move lessons, add breaks, or shift unfinished manually planned days when plans change",
    ],
    note: "Switch between week and month, and open a day for more detail.",
  },
  {
    id: "garden",
    label: "Garden",
    emoji: "🌳",
    location: "Garden",
    headline: "Watch their year take root",
    sub: "Each child has a tree that grows with the learning and memories you record this school year.",
    bullets: [
      "Completed lessons, captured memories, and completed activities add leaves",
      `Grow through ${GROWTH_STAGES.length} stages: ${GROWTH_STAGES.map((stage) => stage.name).join(" → ")}`,
      "Start a fresh tree each school year and revisit finished trees in Years",
    ],
    note: `${finalStage.name} begins at ${finalStage.min} leaves. Every leaf along the way counts.`,
  },
  {
    id: "printables",
    label: "Printables",
    emoji: "🖨️",
    location: "Printables",
    headline: "Little keepsakes you can hold",
    sub: "Celebrate a milestone, make a school ID, or put the year's plan where everyone can see it.",
    bullets: [
      "Make student, educator, graduation, and custom certificates",
      "Create parent and student ID cards with a photo",
      "Explore the year planner and first-day and fall photo frames",
    ],
    note: "Photo frames are free. Other downloads require Rooted+ or an active trial.",
  },
  {
    id: "yearbook",
    label: "Yearbook",
    emoji: "📖",
    location: "Memories → Yearbook",
    headline: "Your family's year, in a book",
    sub: "Open the reader any time to see the memories you've been collecting come together.",
    bullets: [
      "New photo and field trip captures are included by default; hide any you don't want in the book",
      "Personalize the cover, add a letter from home, and fill in each child's interview",
      "Read your yearbook as it grows, with books, wins, artwork, and learning memories",
    ],
    note: "The full reader and yearbook PDF are part of Rooted+ or an active trial.",
  },
  {
    id: "reports",
    label: "Reports",
    emoji: "📋",
    location: "More → Reports on mobile; Reports in the desktop sidebar",
    headline: "Keep the records you need",
    sub: "Bring together the hours, attendance, and reading you've recorded, with dates and child filters that fit the record you need.",
    bullets: [
      "Review the Hours & Attendance Log for lessons, memories, and activities with recorded time",
      "Keep a Reading Log of the books you've added",
      "Use the separate Download Progress Report option in Plan for a plan and progress summary",
    ],
    note: "Report downloads require Rooted+ or an active trial.",
  },
  {
    id: "transcripts",
    label: "Transcripts",
    emoji: "🎓",
    location: "More → Transcripts on mobile; Transcripts in the desktop sidebar",
    headline: "Build their high school record",
    sub: "Keep courses, credits, and grades together as you prepare a transcript for your student.",
    bullets: [
      "Add courses by school year with grades and credits",
      "Review GPA and credit totals as you build the record",
      "Preview and download a formatted transcript PDF",
    ],
    note: "Transcript PDF downloads require Rooted+ or an active trial. Review the recipient's requirements before submitting.",
  },
  {
    id: "years",
    label: "Years",
    emoji: "🗂️",
    location: "More → Years",
    headline: "A place for every school year",
    sub: "Keep this year's learning together and come back to the years you've already finished.",
    bullets: [
      "Review your current school year and its dates",
      "Look back at closed years, their records, and finished garden trees",
      "Add a past year or close the current year when you're ready to begin the next",
    ],
    note: "Closing a year is a separate step you review and confirm.",
  },
  {
    id: "resources",
    label: "Resources",
    emoji: "📚",
    location: "More → Resources on mobile; Resources in the desktop sidebar",
    headline: "Find something for your next lesson",
    sub: "Browse learning ideas and resources when you want a little inspiration.",
    bullets: [
      "Explore Free Picks, Easy Wins, curriculum, activities, and field trips",
      "Browse categories and save resources you want to come back to",
      "Find state information separately in By State",
    ],
    note: "State guidance is a starting point. Check current requirements with your state's official sources.",
  },
];
