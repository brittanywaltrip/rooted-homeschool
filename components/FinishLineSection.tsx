'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePartner } from '@/lib/partner-context'
import FinishLineCard from './FinishLineCard'
import FinishLineModal from './FinishLineModal'
import Toast from './Toast'

type Child = { id: string; name: string; color: string | null }
type Goal = {
  id: string
  child_id: string
  curriculum_name: string
  subject_label: string | null
  total_lessons: number
  current_lesson: number
  target_date: string
  created_at: string
  school_days?: string[]
}
type GoalWithChild = Goal & { child_name: string; child_color: string }

export default function FinishLineSection() {
  const { effectiveUserId } = usePartner()
  const [goals,        setGoals]        = useState<GoalWithChild[]>([])
  const [children,     setChildren]     = useState<Child[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingGoal,  setEditingGoal]  = useState<GoalWithChild | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [toast,        setToast]        = useState('')

  async function loadGoals() {
    if (!effectiveUserId) return
    const [{ data: goalsData }, { data: childrenData }] = await Promise.all([
      supabase.from('curriculum_goals').select('*').eq('user_id', effectiveUserId).order('created_at', { ascending: true }),
      supabase.from('children').select('id, name, color').eq('user_id', effectiveUserId).eq('archived', false).order('sort_order'),
    ])
    const kids = childrenData ?? []
    setChildren(kids)
    const enriched: GoalWithChild[] = (goalsData ?? [])
      .filter((g) => kids.some((c) => c.id === g.child_id))
      .map((g) => {
        const child = kids.find((c) => c.id === g.child_id)!
        return { ...g, child_name: child.name, child_color: child.color ?? '#5c7f63' }
      })
    setGoals(enriched)
    setLoading(false)
  }

  useEffect(() => { loadGoals() }, [effectiveUserId])

  if (loading) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65]">Finish Line 🎯</h2>
        <button onClick={() => setShowAddModal(true)} className="text-xs font-medium text-[#5c7f63] bg-[#e8f0e9] hover:bg-[#d4ead4] px-3 py-1 rounded-full transition-colors">+ Add Goal</button>
      </div>

      {goals.length === 0 ? (
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 flex items-center gap-3">
          <span className="text-2xl">🎯</span>
          <div>
            <p className="text-sm font-medium text-[#2d2926]">No curriculum goals yet</p>
            <p className="text-xs text-[#b5aca4]">Add a goal to see if you&apos;re on track to finish on time.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.map((goal) => (
            <FinishLineCard
              key={goal.id}
              goal={goal}
              onEdit={() => setEditingGoal(goal)}
              onUpdate={loadGoals}
              showToast={setToast}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <FinishLineModal
          children={children}
          onClose={() => setShowAddModal(false)}
          onSaved={loadGoals}
          showToast={setToast}
        />
      )}
      {editingGoal && (
        <FinishLineModal
          children={children}
          goal={editingGoal}
          onClose={() => setEditingGoal(null)}
          onSaved={loadGoals}
          showToast={setToast}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast('')} />}
    </div>
  )
}
