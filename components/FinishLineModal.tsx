'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Child = { id: string; name: string; color: string | null }
type Goal = { id?: string; child_id: string; curriculum_name: string; subject_label: string | null; total_lessons: number; current_lesson: number; target_date: string }
interface Props { children: Child[]; goal?: Goal & { id: string }; onClose: () => void; onSaved: () => void }

export default function FinishLineModal({ children, goal, onClose, onSaved }: Props) {
  const [childId, setChildId] = useState(goal?.child_id ?? (children[0]?.id ?? ''))
  const [curriculumName, setCurriculumName] = useState(goal?.curriculum_name ?? '')
  const [subjectLabel, setSubjectLabel] = useState(goal?.subject_label ?? '' )
  const [totalLessons, setTotalLessons] = useState(String(goal?.total_lessons ?? ''))
  const [currentLesson, setCurrentLesson] = useState(String(goal?.current_lesson ?? ''))
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!curriculumName.trim() || !totalLessons || !targetDate || !childId) { setError('Please fill in all required fields.'); return }
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const payload = { user_id: user.id, child_id: childId, curriculum_name: curriculumName.trim(), subject_label: subjectLabel.trim() || null, total_lessons: parseInt(totalLessons), current_lesson: parseInt(currentLesson) || 0, target_date: targetDate, updated_at: new Date().toISOString() }
    if (goal?.id) { await supabase.from('curriculum_goals').update(payload).eq('id', goal.id) }
    else { await supabase.from('curriculum_goals').insert(payload) }
    setSaving(false); onSaved(); onClose()
  }

  async function handleDelete() {
    if (!goal?.id) return
    setDeleting(true)
    await supabase.from('curriculum_goals').delete().eq('id', goal.id)
    setDeleting(false); onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#fefcf9] rounded-3xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[#2d2926]">🎯 {goal ? 'Edit' : 'Add'} Curriculum Goal</h2>
          <button onClick={onClose} className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none">×</button>
        </div>
        <div>
          <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Child *</label>
          <select value={childId} onChange={e => setChildId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]">
            {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Curriculum name *</label>
          <input value={curriculumName} onChange={e => setCurriculumName(e.target.value)} placeholder="e.g. The Good and the Beautiful" className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
        </div>
        <div>
          <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Subject (optional)</label>
          <input value={subjectLabel} onChange={e => setSubjectLabel(e.target.value)} placeholder="e.g. Language Arts, Math" className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Total lessons *</label>
            <input value={totalLessons} onChange={e => setTotalLessons(e.target.value)} type="number" min="1" placeholder="e.g. 120" className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Current lesson *</label>
            <input value={currentLesson} onChange={e => setCurrentLesson(e.target.value)} type="number" min="0" placeholder="e.g. 52" className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-[#7a6f65] block mb-1.5">Goal finish date *</label>
          <input value={targetDate} onChange={e => setTargetDate(e.target.value)} type="date" className="w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20" />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 pt-1">
          {goal && (
            <button onClick={handleDelete} disabled={deleting} className="px-4 py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-400 hover:bg-red-50 transition-colors disabled:opacity-50">
              {deleting ? '…' : 'Delete'}
            </button>
          )}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-medium text-[#7a6f65] hover:bg-[#f0ede8] transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {saving ? 'Saving…' : goal ? 'Save Changes' : 'Add Goal 🎯'}
          </button>
        </div>
      </div>
    </div>
  )
}
