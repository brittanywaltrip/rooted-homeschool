export const SUBJECT_CATEGORIES = [
  { value: 'english', label: 'English / Language Arts', color: 'blue' },
  { value: 'math', label: 'Mathematics', color: 'red' },
  { value: 'science', label: 'Science', color: 'green' },
  { value: 'social_studies', label: 'Social Studies / History', color: 'amber' },
  { value: 'foreign_language', label: 'Foreign Language', color: 'purple' },
  { value: 'arts', label: 'Fine Arts', color: 'pink' },
  { value: 'pe', label: 'Physical Education', color: 'teal' },
  { value: 'technology', label: 'Technology', color: 'slate' },
  { value: 'bible', label: 'Bible / Theology', color: 'indigo' },
  { value: 'electives', label: 'Electives', color: 'orange' },
  { value: 'life_skills', label: 'Life Skills', color: 'yellow' },
  { value: 'other', label: 'Other', color: 'gray' },
] as const;

export const CREDIT_TYPES = [
  { value: 'standard', label: 'Standard' },
  { value: 'honors', label: 'Honors' },
  { value: 'ap', label: 'AP' },
  { value: 'dual_enrollment', label: 'Dual Enrollment' },
  { value: 'co_op', label: 'Co-op' },
  { value: 'life_skills', label: 'Life Skills' },
] as const;

export const GRADE_OPTIONS = [
  'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'
] as const;

export const SEMESTERS = [
  { value: 'full_year', label: 'Full Year' },
  { value: 'semester_1', label: 'Semester 1' },
  { value: 'semester_2', label: 'Semester 2' },
] as const;

// Generate school year options (current + 3 past + 3 future)
export function getSchoolYearOptions(): string[] {
  const now = new Date();
  const currentYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const years: string[] = [];
  for (let i = -3; i <= 3; i++) {
    const y = currentYear + i;
    years.push(`${y}-${y + 1}`);
  }
  return years;
}
