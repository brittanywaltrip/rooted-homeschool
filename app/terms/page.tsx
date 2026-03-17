import Link from "next/link";

export default function TermsPage() {
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
          <h1 className="text-4xl font-bold text-[#2d2926] mb-3">Terms of Service</h1>
          <p className="text-[#7a6f65] text-sm">Last updated: March 2026</p>
        </div>

        {/* Intro */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 mb-8">
          <p className="text-[#7a6f65] leading-relaxed">
            Welcome to Rooted Homeschool. By creating an account or using our service, you agree to
            these Terms of Service. Please read them carefully. If you have questions, contact us at{" "}
            <a href="mailto:hello@rootedhomeschool.app" className="text-[#5c7f63] hover:underline font-medium">
              hello@rootedhomeschool.app
            </a>
            .
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {/* Acceptance of Terms */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                📜
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">1. Acceptance of Terms</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                By accessing or using Rooted Homeschool (&quot;Service&quot;), you agree to be bound by
                these Terms of Service and our Privacy Policy. If you do not agree to these terms,
                please do not use the Service.
              </p>
              <p>
                These terms apply to all users, including visitors, registered users, and paying
                subscribers. We reserve the right to update these terms at any time. We will notify
                you of material changes via email or a notice within the app.
              </p>
            </div>
          </section>

          {/* Use of Service */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                🌱
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">2. Use of Service</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                Rooted Homeschool is designed for personal, non-commercial use by homeschool families
                to plan, track, and document their children&apos;s education. You agree to use the
                Service only for lawful purposes.
              </p>
              <p>You agree not to:</p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Share your account credentials or allow others outside your household to access your account.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Use the Service for any commercial purpose without our prior written consent.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Attempt to reverse-engineer, copy, or create derivative works of the Service.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span>Upload content that is unlawful, harmful, or violates the rights of others.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Subscription and Billing */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                💳
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">3. Subscription and Billing</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                Rooted Homeschool offers a free trial period followed by a paid annual subscription.
                Subscription details, including pricing, are displayed at the time of purchase.
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Billing:</strong> Subscriptions are billed annually and renew automatically unless cancelled before the renewal date.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Founding Family pricing:</strong> If you subscribed at a founding family rate, that price is locked in for you as long as you maintain an active subscription.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Cancellation:</strong> You may cancel your subscription at any time. Access continues until the end of your paid billing period. We do not offer prorated refunds.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">•</span>
                  <span><strong className="text-[#2d2926]">Refunds:</strong> Refund requests within 14 days of initial purchase will be considered on a case-by-case basis. Contact us to request a refund.</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Intellectual Property */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                ©️
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">4. Intellectual Property</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                The Rooted Homeschool app, including its design, code, branding, and content created
                by us, is owned by Rooted Homeschool and protected by copyright and intellectual
                property laws.
              </p>
              <p>
                Content you create within the app — lesson plans, notes, memories, and reports —
                belongs to you. You grant us a limited license to store and display that content
                solely for the purpose of providing the Service to you.
              </p>
              <p>
                You may not reproduce, distribute, or create derivative works from any part of our
                Service without our express written permission.
              </p>
            </div>
          </section>

          {/* Disclaimer */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                📢
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">5. Disclaimer</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                Rooted Homeschool is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any
                kind, either express or implied. We do not warrant that the Service will be
                uninterrupted, error-free, or free of harmful components.
              </p>
              <p>
                The resources and information provided within the app are for general informational
                purposes. We are not responsible for ensuring that your use of the Service meets any
                specific state or local homeschool compliance requirements. Always verify compliance
                requirements with your state or local authorities.
              </p>
            </div>
          </section>

          {/* Limitation of Liability */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                ⚖️
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">6. Limitation of Liability</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                To the fullest extent permitted by applicable law, Rooted Homeschool and its founders,
                employees, and affiliates shall not be liable for any indirect, incidental, special,
                consequential, or punitive damages arising from your use of or inability to use the
                Service.
              </p>
              <p>
                In no event shall our total liability to you exceed the amount you paid for the
                Service in the twelve months preceding the claim.
              </p>
            </div>
          </section>

          {/* Termination */}
          <section className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-base">
                🚪
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">7. Termination</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                You may delete your account at any time through your account settings or by contacting
                us. Upon deletion, your data will be removed in accordance with our Privacy Policy.
              </p>
              <p>
                We reserve the right to suspend or terminate your account if you violate these Terms
                of Service, with or without notice. In the event of termination due to a violation,
                you will not be entitled to a refund.
              </p>
            </div>
          </section>

          {/* Contact */}
          <section className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-xl bg-white/60 flex items-center justify-center text-base">
                ✉️
              </div>
              <h2 className="text-lg font-bold text-[#2d2926]">8. Contact</h2>
            </div>
            <div className="space-y-3 text-sm text-[#7a6f65] leading-relaxed">
              <p>
                If you have any questions about these Terms of Service or need to reach us for any
                reason, please contact:
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
                We aim to respond to all inquiries within 5 business days.
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
            <Link href="/privacy" className="hover:text-[#5c7f63] transition-colors">Privacy</Link>
            <Link href="/terms" className="text-[#5c7f63] font-medium">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
