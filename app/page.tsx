export default function Home() {
  return (
    <main className="min-h-screen bg-[#f8f7f4] text-gray-800">
      <header className="p-6 border-b">
        <h1 className="text-2xl font-semibold text-[#7a9e7e]">
          Rooted Homeschool
        </h1>
      </header>

      <section className="flex flex-col items-center text-center px-6 py-24">
        <h2 className="text-4xl font-bold mb-4">
          Stay Rooted. Teach with Intention.
        </h2>
        <p className="max-w-xl text-gray-600 mb-8">
          A simple homeschool planner to track lessons, monitor progress, and create
          peaceful structure for your family.
        </p>

        <div className="flex gap-4">
          <a
            href="/signup"
            className="bg-[#7a9e7e] text-white px-6 py-3 rounded-lg"
          >
            Create Account
          </a>

          <a
            href="/login"
            className="border border-[#7a9e7e] text-[#7a9e7e] px-6 py-3 rounded-lg"
          >
            Log In
          </a>
        </div>
      </section>

      <footer className="border-t py-6 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Rooted Homeschool
      </footer>
    </main>
  );
}