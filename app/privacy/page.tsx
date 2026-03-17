import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#f8f7f4] text-[#2d2926]">
      {/* Navbar */}
      <header className="sticky top-0 z-40 bg-[#f8f7f4]/90 backdrop-blur border-b border-[#e8e2d9]">
        <div className="px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">
              🌿
            </div>
            <span className="text-base font-bold text-[#2d2926]">Rooted Homeschool</span>
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-[#7a6f65] hover:text-[#2d2926] transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 bg-[#e8f0e9] text-[#5c7f63] text-xs font-semibold px-4 py-1.5 rounded-full mb-5 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5c7f63]" />
            Legal
          </div>
          <h1 className="text-4xl font-bold text-[#2d2926] mb-3">Privacy Policy</h1>
          <p className="text-[#7a6f65] text-sm">Last updated: March 2026</p>
        </div>

        {/* Intro */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 mb-8">
          <p className="text-[#7a6f65] leading-relaxed">
            At Rooted Homeschool, your family&apos;s privacy is important to us. This Privacy Policy
            explains how we collect, use, and protect information when you use our service. We believe
            in transparency and are committed to handling your data with care and respect.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {/* Information We Collect */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                📋
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">Information We Collect</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>We collect information you provide directly to us when you create an account or use our service:</p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Account information:</strong> Your name, email address, and password when you register.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Child profiles:</strong> Names and grade levels you add for your children (no government IDs or sensitive personal data).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Learning data:</strong> Lesson plans, completion records, notes, and memories you create within the app.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Usage data:</strong> How you interact with the app, including features used and time spent, to help us improve.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* How We Use Information */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                🔍
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">How We Use Information</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>We use the information we collect to:</p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Provide, maintain, and improve Rooted Homeschool and its features.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Send transactional emails such as account confirmations and password resets.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Respond to your comments, questions, and support requests.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Understand usage patterns to develop new features that serve homeschool families better.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Send occasional product updates or newsletters — you can unsubscribe at any time.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Data Storage */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                🗄️
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">Data Storage</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                Your data is stored securely using Supabase, a trusted cloud infrastructure provider
                with SOC 2 compliance. Data is stored on servers located in the United States.
              </p>
              <p>
                We retain your data for as long as your account is active. If you delete your account,
                we will delete your personal data within 30 days, except where we are required by law
                to retain it for longer.
              </p>
              <p>
                You can export all of your data at any time by contacting us at the email address
                listed below.
              </p>
            </div>
          </section>

          {/* Sharing */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                🤝
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">Sharing Your Information</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                We do not sell, rent, or trade your personal information to third parties. We may share
                your information only in the following limited circumstances:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Service providers:</strong> Trusted vendors who help us operate the app (e.g., payment processing, email delivery), bound by confidentiality agreements.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Legal requirements:</strong> If required by law or to protect the rights, safety, or property of Rooted Homeschool or its users.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Business transfers:</strong> In the event of a merger or acquisition, your data may be transferred as part of that transaction.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Security */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                🔒
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">Security</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                We take the security of your family&apos;s data seriously. We implement industry-standard
                safeguards including:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Encryption of data in transit using TLS/HTTPS.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Encrypted storage of passwords — we never store them in plain text.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Row-level security policies to ensure each family can only access their own data.</span>
                </li>
              </ul>
              <p>
                While we strive to protect your information, no method of transmission over the
                internet is 100% secure. We encourage you to use a strong, unique password for your
                account.
              </p>
            </div>
          </section>

          {/* Contact */}
          <section className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center text-base">
                ✉️
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">Contact Us</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                If you have any questions about this Privacy Policy, want to request access to or
                deletion of your data, or have any privacy concerns, please reach out:
              </p>
              <p>
                <strong className="text-[#2d2926]">Email:</strong>{" "}
                <a
                  href="mailto:hello@rootedhomeschool.app"
                  className="text-[#5c7f63] hover:underline font-medium"
                >
                  hello@rootedhomeschool.app
                </a>
              </p>
              <p className="text-xs text-[#7a6f65]">
                We aim to respond to all privacy-related inquiries within 5 business days.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e8e2d9] py-8 px-6 mt-8">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#b5aca4]">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#5c7f63] flex items-center justify-center text-xs">
              🌿
            </div>
            <span className="font-medium text-[#7a6f65]">Rooted Homeschool</span>
          </Link>
          <p>© {new Date().getFullYear()} Rooted Homeschool — Made with care for learning families</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="text-[#5c7f63] font-medium">Privacy</Link>
            <Link href="/terms" className="hover:text-[#5c7f63] transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
