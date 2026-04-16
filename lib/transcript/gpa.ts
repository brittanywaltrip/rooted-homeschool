const GRADE_POINTS: Record<string, number> = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7,
  'D+': 1.3, 'D': 1.0, 'D-': 0.7,
  'F': 0.0
};

const WEIGHTED_BONUS: Record<string, number> = {
  'honors': 0.5,
  'ap': 1.0,
  'dual_enrollment': 1.0,
};

export type CourseForGPA = {
  grade_letter: string | null;
  credits_earned: number;
  credit_type: string;
};

export function getGradePoints(gradeLetter: string | null): number | null {
  if (!gradeLetter) return null;
  return GRADE_POINTS[gradeLetter] ?? null;
}

export function calculateGPA(courses: CourseForGPA[], weighted: boolean = false): number | null {
  const gradedCourses = courses.filter(c => c.grade_letter && c.credits_earned > 0);
  if (gradedCourses.length === 0) return null;

  let totalPoints = 0;
  let totalCredits = 0;

  for (const course of gradedCourses) {
    const basePoints = GRADE_POINTS[course.grade_letter!];
    if (basePoints === undefined) continue;

    const bonus = weighted ? (WEIGHTED_BONUS[course.credit_type] || 0) : 0;
    totalPoints += (basePoints + bonus) * course.credits_earned;
    totalCredits += course.credits_earned;
  }

  if (totalCredits === 0) return null;
  return Math.round((totalPoints / totalCredits) * 100) / 100;
}

export function calculateYearlyGPA(
  courses: CourseForGPA[],
  schoolYear: string,
  weighted: boolean = false
): number | null {
  // Filter handled by caller — this is just for clarity
  return calculateGPA(courses, weighted);
}

export function getCreditsBySubject(courses: { subject_category: string; credits_earned: number }[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const c of courses) {
    result[c.subject_category] = (result[c.subject_category] || 0) + c.credits_earned;
  }
  return result;
}

export const COLLEGE_READY_TARGETS: Record<string, number> = {
  english: 4,
  math: 3,
  science: 3,
  social_studies: 3,
  foreign_language: 2,
};

export { GRADE_POINTS, WEIGHTED_BONUS };
