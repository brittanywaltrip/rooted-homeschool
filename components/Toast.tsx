'use client'
import { useEffect } from 'react'

export default function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    // `toast-slide-up` sits on THIS element, the one carrying `left-1/2`, and
    // that pairing is load-bearing. The keyframes carry translateX(-50%) (see
    // app/globals.css) because the animation runs `forwards` and would
    // otherwise erase a Tailwind `-translate-x-1/2` for the element's whole
    // life. While the animation was on the inner pill instead, that -50% would
    // have been applied to the pill — which is not the element being centred —
    // and dragged it half its own width off the wrapper. Keep the animation and
    // the centering on the same element.
    <div className="fixed bottom-6 left-1/2 z-[70] pointer-events-none px-4 w-full max-w-sm toast-slide-up">
      <div className="bg-[#2d2926] text-white text-sm font-medium px-5 py-3.5 rounded-2xl shadow-xl text-center leading-relaxed">
        {message}
      </div>
    </div>
  )
}
