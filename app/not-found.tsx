import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16"
         style={{ backgroundColor: "#f8f7f4" }}>
      <Image
        src="/rooted-logo-nav.png"
        alt="Rooted"
        width={140}
        height={40}
        className="mb-12"
        priority
      />

      <h1
        className="text-3xl sm:text-4xl text-center mb-3"
        style={{ fontFamily: "var(--font-display), Georgia, serif", color: "#2d4a35", fontWeight: 400 }}
      >
        This page got lost in the garden.
      </h1>

      <p className="text-center mb-10" style={{ color: "#7a6f65", fontSize: "1.05rem" }}>
        It may have moved or never existed.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/"
          className="px-6 py-2.5 rounded-lg text-center text-sm font-medium transition-colors"
          style={{ backgroundColor: "#2d5a3d", color: "#fff" }}
        >
          Go home
        </Link>
        <Link
          href="/dashboard"
          className="px-6 py-2.5 rounded-lg text-center text-sm font-medium border transition-colors"
          style={{ borderColor: "#2d5a3d", color: "#2d5a3d" }}
        >
          Go to my dashboard
        </Link>
      </div>
    </div>
  );
}
