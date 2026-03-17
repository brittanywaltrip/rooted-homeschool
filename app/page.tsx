import Link from "next/link";
import HashRedirect from "./components/HashRedirect";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f8f7f4] text-[#2d2926]">
      <HashRedirect />
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-4xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🌿</span>
          <span className="text-xl font-semibold text-[#5c7f63]">Rooted Homeschool</span>
        </div>
        <Link
          href="/login"
          className="text-sm font-medium text-[#5c7f63] hover:text-[#3d5c42] transition-colors"
        >
          Log In
        </Link>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-16 pb-24 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-[#e8f0e9] text-[#5c7f63] text-sm font-medium px-4 py-1.5 rounded-full mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-[#5c7f63]" />
          Peaceful planning for intentional families
        </div>

        <h1 className="text-5xl font-bold leading-tight mb-5 text-[#2d2926]">
          Stay Rooted.{" "}
          <span className="text-[#5c7f63]">Teach with</span>{" "}
          Intention.
        </h1>

        <p className="text-lg text-[#7a6f65] mb-10 leading-relaxed max-w-lg">
          A gentle homeschool companion to plan your days, track your children's
          progress, and celebrate every step of the learning journey.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Link
            href="/signup"
            className="bg-[#5c7f63] hover:bg-[#3d5c42] text-white px-8 py-3.5 rounded-xl font-medium text-base transition-colors shadow-sm"
          >
            Start for Free
          </Link>
          <Link
            href="/login"
            className="border-2 border-[#5c7f63] text-[#5c7f63] hover:bg-[#e8f0e9] px-8 py-3.5 rounded-xl font-medium text-base transition-colors"
          >
            Log In
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 pb-24 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              emoji: "🗓️",
              title: "Plan Your Days",
              desc: "Map out lessons and activities with a calm, clutter-free planner built for real family life.",
            },
            {
              emoji: "📈",
              title: "Track Growth",
              desc: "Celebrate milestones and watch your children's knowledge take root and grow over time.",
            },
            {
              emoji: "🌱",
              title: "Stay Grounded",
              desc: "Keep your family's unique goals and values at the center of every learning day.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6"
            >
              <div className="text-3xl mb-3">{f.emoji}</div>
              <h3 className="font-semibold text-[#2d2926] mb-1.5">{f.title}</h3>
              <p className="text-sm text-[#7a6f65] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#e8e2d9] py-6 text-center text-sm text-[#7a6f65]">
        <span className="mr-1">🌿</span>
        © {new Date().getFullYear()} Rooted Homeschool — Made with care for learning families
      </footer>
    </main>
  );
}
