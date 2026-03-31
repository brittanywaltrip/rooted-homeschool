'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Child = { id: string; name: string; color: string | null }
type Goal = {
  id?: string
  child_id: string
  curriculum_name: string
  subject_label: string | null
  total_lessons: number
  current_lesson: number
  target_date: string
  school_days?: string[]
}
interface Props {
  children: Child[]
  goal?: Goal & { id: string }
  onClose: () => void
  onSaved: () => void
  showToast: (msg: string) => void
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_NUMS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function suggestFinishDate(total: number, current: number): string {
  const remaining = total - current
  if (remaining <= 0) return ''
  const weeksNeeded = Math.ceil(remaining / 4)
  const d = new Date()
  d.setDate(d.getDate() + weeksNeeded * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateNice(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function buildSchedule(
  startLesson: number,
  totalLessons: number,
  schoolDays: string[],
): { lessonNumber: number; scheduledDate: string }[] {
  const selectedNums = schoolDays.map(d => DAY_NUMS[d]).sort((a, b) => a - b)
  const result: { lessonNumber: number; scheduledDate: string }[] = []
  const cursor = new Date()
  cursor.setDate(cursor.getDate() + 1)
  cursor.setHours(0, 0, 0, 0)
  let n = startLesson
  while (n <= totalLessons) {
    if (selectedNums.includes(cursor.getDay())) {
      result.push({ lessonNumber: n, scheduledDate: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}` })
      n++
    }
    cursor.setDate(cursor.getDate() + 1)
    if (result.length > 1500) break // safety valve
  }
  return result
}

export default function FinishLineModal({ children, goal, onClose, onSaved, showToast }: Props) {
  const [childId,        setChildId]        = useState(goal?.child_id ?? (children[0]?.id ?? ''))
  const [curriculumName, setCurriculumName]  = useState(goal?.curriculum_name ?? '')
  const [subjectLabel,   setSubjectLabel]   = useState(goal?.subject_label ?? '')
  const [totalLessons,   setTotalLessons]   = useState(String(goal?.total_lessons ?? ''))
  const [currentLesson,  setCurrentLesson]  = useState(String(goal?.current_lesson ?? '0'))
  const [targetDate,     setTargetDate]     = useState(goal?.target_date ?? '')
  const [schoolDays,     setSchoolDays]     = useState<string[]>(goal?.school_days ?? [])
  const [saving,         setSaving]         = useState(false)
  const [deleting,       setDeleting]       = useState(false)
  const [error,          setError]          = useState('')
  const [daysError,      setDaysError]      = useState(false)
  const [scheduleWarning, setScheduleWarning] = useState('')

  const total   = parseInt(totalLessons)  || 0
  const current = parseInt(currentLesson) || 0

  // Suggested date based on 4-day school week (only shown on create)
  const suggested = totalLessons && !goal ? suggestFinishDate(total, current) : ''

  // Live schedule warning: will they finish before the goal date?
  useEffect(() => {
    if (!totalLessons || !targetDate || schoolDays.length === 0) {
      setScheduleWarning(''); return
    }
    const schedule = buildSchedule(current + 1, total, schoolDays)
    if (schedule.length === 0) { setScheduleWarning(''); return }
    const last   = new Date(schedule[schedule.length - 1].scheduledDate + 'T00:00:00')
    const target = new Date(targetDate + 'T00:00:00')
    if (last > target) {
      setScheduleWarning("At this pace you'll finish a bit after your goal date — that's okay! You can always reschedule. 🌿")
    } else {
      setScheduleWarning('')
    }
  }, [totalLessons, currentLesson, targetDate, schoolDays])

  function toggleDay(day: string) {
    setSchoolDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
    setDaysError(false)
  }

  async function handleSave() {
    if (!curriculumName.trim() || !totalLessons || !targetDate || !childId) {
      setError('Please fill in all required fields.'); return
    }
    if (schoolDays.length === 0) {
      setDaysError(true); return
    }
    setSaving(true); setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const basePayload = {
      user_id: user.id,
      child_id: childId,
      curriculum_name: curriculumName.trim(),
      subject_label: subjectLabel.trim() || null,
      total_lessons: total,
      current_lesson: current,
      target_date: targetDate,
      default_minutes: 30,
      updated_at: new Date().toISOString(),
    }

    // Try with school_days first; fall back gracefully if the column doesn't
    // exist yet (i.e. the migration hasn't been run in Supabase).
    async function tryInsertOrUpdate(includeSchoolDays: boolean) {
      const payload = includeSchoolDays
        ? { ...basePayload, school_days: schoolDays }
        : basePayload

      if (goal?.id) {
        const { error } = await supabase.from('curriculum_goals').update(payload).eq('id', goal.id)
        return { goalId: goal.id, error }
      } else {
        const { data, error } = await supabase
          .from('curriculum_goals').insert(payload).select('id').single()
        return { goalId: data?.id ?? null, error }
      }
    }

    let { goalId, error: saveError } = await tryInsertOrUpdate(true)

    // If the error mentions school_days the migration hasn't been run — retry without it
    if (saveError && saveError.message?.includes('school_days')) {
      const result = await tryInsertOrUpdate(false)
      goalId    = result.goalId
      saveError = result.error
    }

    if (saveError) {
      setError(saveError.message || 'Something went wrong. Please try again.')
      setSaving(false)
      return
    }

    // Schedule lessons (create only, and only if the curriculum_goal_id column exists)
    if (goalId && !goal?.id) {
      const schedule = buildSchedule(current + 1, total, schoolDays)
      if (schedule.length > 0) {
        const rows = schedule.map(s => ({
          user_id: user.id,
          child_id: childId,
          title: `${curriculumName.trim()} · Lesson ${s.lessonNumber}`,
          completed: false,
          scheduled_date: s.scheduledDate,
          curriculum_goal_id: goalId,
          lesson_number: s.lessonNumber,
        }))
        const { error: lessonsError } = await supabase.from('lessons').insert(rows)
        if (!lessonsError) {
          const child = children.find(c => c.id === childId)
          showToast(`🎉 ${schedule.length} lessons scheduled for ${child?.name ?? 'your child'}! Your plan is all set.`)
        }
        // If lesson insert fails (columns missing) we still saved the goal — don't block
      }
    }

    setSaving(false); onSaved(); onClose()
  }

  async function handleDelete() {
    if (!goal?.id) return
    setDeleting(true)
    // Best-effort: remove incomplete scheduled lessons (ignore error if columns missing)
    await supabase.from('lessons').delete().eq('curriculum_goal_id', goal.id).eq('completed', false)
    const { error: delError } = await supabase.from('curriculum_goals').delete().eq('id', goal.id)
    if (delError) {
      setError(delError.message || 'Could not delete. Please try again.')
      setDeleting(false); return
    }
    setDeleting(false); onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="p-6 space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-[#2d2926] text-base">🎯 {goal ? 'Edit' : 'Add'} Curriculum Goal</h2>
            <button onClick={onClose} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
          </div>

          {/* Child */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child *</label>
            <select value={childId} onChange={e => setChildId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
              {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Curriculum name */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Curriculum name *</label>
            <input value={curriculumName} onChange={e => setCurriculumName(e.target.value)}
              placeholder="e.g. The Good and the Beautiful"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject (optional)</label>
            <input value={subjectLabel} onChange={e => setSubjectLabel(e.target.value)}
              placeholder="e.g. Language Arts, Math"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
          </div>

          <hr className="border-[#f0ede8]" />

          {/* Total / Current lessons */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Total lessons *</label>
              <input value={totalLessons} onChange={e => setTotalLessons(e.target.value)}
                type="number" min="1" placeholder="e.g. 120"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <p className="text-[10px] text-[#b5aca4] mt-1.5 leading-snug">
                Check your curriculum&apos;s table of contents for the total count
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Current lesson</label>
              <input value={currentLesson} onChange={e => setCurrentLesson(e.target.value)}
                type="number" min="0" placeholder="0"
                className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
              <p className="text-[10px] text-[#b5aca4] mt-1.5 leading-snug">
                Pick up right where you left off
              </p>
            </div>
          </div>

          {/* Goal finish date */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Goal finish date *</label>
            <input value={targetDate} onChange={e => setTargetDate(e.target.value)}
              type="date"
              className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
            {suggested && !targetDate && (
              <button type="button" onClick={() => setTargetDate(suggested)}
                className="mt-2 text-[10px] text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-2.5 py-1 rounded-full transition-colors">
                ✨ Suggested: {formatDateNice(suggested)} (4 days/week)
              </button>
            )}
          </div>

          {/* School days selector */}
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-2">Which days do you homeschool?</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map(day => (
                <button key={day} type="button" onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all select-none ${
                    schoolDays.includes(day)
                      ? 'bg-[#5c7f63] text-white border-[#5c7f63]'
                      : 'bg-white text-[#7a6f65] border-[#e8e2d9] hover:border-[#5c7f63] hover:text-[#5c7f63]'
                  }`}>
                  {day}
                </button>
              ))}
            </div>
            {daysError && (
              <p className="text-xs text-[#5c7f63] mt-2">
                Pick at least one school day so we can build your schedule 🌱
              </p>
            )}
          </div>

          {/* Schedule warning */}
          {scheduleWarning && (
            <div className="bg-[#fef9ec] border border-[#fcd97b] rounded-xl px-3 py-2.5">
              <p className="text-xs text-[#7a6f65] leading-relaxed">{scheduleWarning}</p>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {goal && (
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-400 hover:bg-red-50 transition-colors disabled:opacity-50">
                {deleting ? '…' : 'Delete'}
              </button>
            )}
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
              {saving ? 'Saving…' : goal ? 'Save Changes' : 'Add Goal 🎯'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
