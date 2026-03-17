'use client'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface FinishLineCardProps {
  goal: {
    id: string
    curriculum_name: string
    subject_label: string | null
    total_lessons: number
    current_lesson: number
    target_date: string
    child_name: string
    child_color: string
    created_at: string
  }
  onEdit: () => void
  onUpdate: () => void
}

export default function FinishLineCard({ goal, onEdit, onUpdate }: FinishLineCardProps) {
  const [bumping, setBumping] = useState(false)

  async function bumpLesson() {
    if (bumping || goal.current_lesson >= goal.total_lessons) return
    setBumping(true)
    await supabase
      .from('curriculum_goals')
      .update({ current_lesson: goal.current_lesson + 1, updated_at: new Date().toISOString() })
      .eq('id', goal.id)
    setBumping(false)
    onUpdate()
  }

  const today = new Date()
  const target = new Date(goal.target_date)
  const created = new Date(goal.created_at)

  const daysRemaining = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  const weeksRemaining = daysRemaining / 7
  const lessonsRemaining = goal.total_lessons - goal.current_lesson
  const weeksElapsed = Math.max((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 7), 1)
  const currentPace = goal.current_lesson > 0 ? goal.current_lesson / weeksElapsed : 0
  const weeklyNeeded = weeksRemaining > 0 ? lessonsRemaining / weeksRemaining : 0

  const projectedFinish = currentPace > 0
    ? new Date(today.getTime() + (lessonsRemaining / currentPace) * 7 * 24 * 60 * 60 * 1000)
    : null

  const isOnTrack = currentPace >= weeklyNeeded
  const accentColor = isOnTrack ? '#5c7f63' : '#f59e0b'

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  const weeksDiff = projectedFinish
    ? Math.round(Math.abs((projectedFinish.getTime() - target.getTime()) / (1000 * 60 * 60 * 24 * 7)))
    : 0

  let message = ''
  if (goal.current_lesson === 0) {
    message = `🌱 Start logging lessons to see if ${goal.child_name} is on track to finish ${goal.curriculum_name}.`
  } else if (goal.current_lesson < 3) {
    message = `🌱 Keep going! Log a few more lessons and ${goal.child_name}'s pace will be calculated automatically.`
  } else if (isOnTrack && projectedFinish) {
    message = `🌿 At your current pace, ${goal.child_name} will finish ${goal.curriculum_name} by ${formatDate(projectedFinish)} — right on time!`
  } else if (projectedFinish) {
    message = `🍂 At your current pace, ${goal.child_name} would finish ${goal.curriculum_name} on ${formatDate(projectedFinish)} — ${weeksDiff} week${weeksDiff !== 1 ? 's' : ''} after your goal. Aim for ${Math.ceil(weeklyNeeded)} lessons/week to finish by ${formatDate(target)}.`
  }

  const progress = Math.min((goal.current_lesson / goal.total_lessons) * 100, 100)

  return (
    <div className="rounded-xl p-4 relative" style={{ background: '#fefcf9', border: '1px solid #e8f0e9', borderLeft: `4px solid ${accentColor}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: goal.child_color || '#5c7f63' }}>
              {goal.child_name}
            </span>
            {goal.subject_label && (
              <span className="text-xs" style={{ color: '#7a6f65' }}>{goal.subject_label}</span>
            )}
          </div>
          <p className="text-sm font-semibold mb-1" style={{ color: '#2d2926' }}>{goal.curriculum_name}</p>
          <p className="text-sm leading-relaxed" style={{ color: '#7a6f65' }}>{message}</p>
        </div>
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0" style={{ color: '#7a6f65' }}>
          <Pencil size={14} />
        </button>
      </div>
      <div className="mt-3">
        <div className="flex justify-between items-center text-xs mb-1" style={{ color: '#7a6f65' }}>
          <span>Lesson {goal.current_lesson} of {goal.total_lessons}</span>
          <div className="flex items-center gap-2">
            <span>Goal: {formatDate(target)}</span>
            {goal.current_lesson < goal.total_lessons && (
              <button
                onClick={bumpLesson}
                disabled={bumping}
                className="text-xs font-semibold px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
                style={{ background: '#e8f0e9', color: '#5c7f63' }}
                title="Mark one lesson complete"
              >
                {bumping ? '…' : '+1 ✓'}
              </button>
            )}
          </div>
        </div>
        <div className="h-1.5 rounded-full" style={{ background: '#e8f0e9' }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{ width: `${progress}%`, background: accentColor }}
          />
        </div>
      </div>
    </div>
  )
}
