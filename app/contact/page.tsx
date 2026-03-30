export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-10">
          <a href="/" className="text-sm text-[#5c7f63] hover:underline">← Back to Rooted</a>
        </div>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-xl bg-[#5c7f63] flex items-center justify-center text-base">🌿</div>
          <span className="font-bold text-[#2d2926]">Rooted</span>
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Get in Touch</h1>
        <p className="text-[#7a6f65] mb-10">We&apos;re a small family-run team and we read every message personally.</p>

        <div className="space-y-4">
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex items-start gap-4">
            <span className="text-2xl">💌</span>
            <div>
              <h3 className="font-bold text-[#2d2926] mb-1">Email us</h3>
              <p className="text-sm text-[#7a6f65] mb-2">For questions, feedback, or just to say hi.</p>
              <a href="mailto:hello@rootedhomeschoolapp.com" className="text-sm font-semibold text-[#5c7f63] hover:underline">
                hello@rootedhomeschoolapp.com
              </a>
            </div>
          </div>

          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex items-start gap-4">
            <span className="text-2xl">📸</span>
            <div>
              <h3 className="font-bold text-[#2d2926] mb-1">Follow along on Instagram</h3>
              <p className="text-sm text-[#7a6f65] mb-2">Behind the scenes, tips, and updates from our homeschool.</p>
              <a href="https://instagram.com/rootedhomeschool" target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[#5c7f63] hover:underline">
                @rootedhomeschool
              </a>
            </div>
          </div>

          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex items-start gap-4">
            <span className="text-2xl">🐛</span>
            <div>
              <h3 className="font-bold text-[#2d2926] mb-1">Found a bug?</h3>
              <p className="text-sm text-[#7a6f65] mb-2">We&apos;re in beta and actively fixing things. Tell us what happened and we&apos;ll fix it fast.</p>
              <a href="mailto:hello@rootedhomeschoolapp.com?subject=Bug Report" className="text-sm font-semibold text-[#5c7f63] hover:underline">
                Send a bug report →
              </a>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6 flex items-start gap-4">
            <span className="text-2xl">🌱</span>
            <div>
              <h3 className="font-bold text-[#2d2926] mb-1">We respond to everything</h3>
              <p className="text-sm text-[#5c7f63] leading-relaxed">
                Rooted was built by a homeschool mom who knows what it&apos;s like to feel unsupported.
                Every email gets a real response from Brittany, usually within 24 hours.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
