'use client'
import { useEffect } from 'react'

export default function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] pointer-events-none px-4 w-full max-w-sm">
      <div className="bg-[#2d2926] text-white text-sm font-medium px-5 py-3.5 rounded-2xl shadow-xl text-center leading-relaxed toast-slide-up">
        {message}
      </div>
    </div>
  )
}
