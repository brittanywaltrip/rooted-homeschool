export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <a href="/" className="text-sm text-[#5c7f63] hover:underline">← Back to Rooted</a>
        </div>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-xl bg-[#5c7f63] flex items-center justify-center text-base">🌿</div>
          <span className="font-bold text-[#2d2926]">Rooted Homeschool</span>
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#b5aca4] mb-10">Last updated: March 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-[#5c5248]">
          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">1. Information We Collect</h2>
            <p className="leading-relaxed">We collect information you provide directly to us when you create an account, including your family name, email address, and password. We also collect information about your children (names and avatar colors) and the educational content you log within the app (lessons, books, memories, and reflections). We do not collect sensitive personal information such as Social Security numbers, financial data, or government IDs.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">2. How We Use Your Information</h2>
            <p className="leading-relaxed">We use the information we collect to provide, maintain, and improve Rooted Homeschool. This includes generating your family&apos;s progress reports, displaying your garden growth, and personalizing your experience. We do not sell your personal information to third parties. We do not use your data for advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">3. Children&apos;s Privacy</h2>
            <p className="leading-relaxed">Rooted Homeschool is designed for use by parents and guardians to track their children&apos;s education. We collect minimal information about children — only their first names and avatar colors as provided by parents. We do not knowingly collect personal information directly from children under 13. Parents control all data entered about their children and may delete it at any time through the Settings page.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">4. Data Storage and Security</h2>
            <p className="leading-relaxed">Your data is stored securely using Supabase, a trusted database platform with industry-standard encryption. We use row-level security to ensure your family&apos;s data is accessible only to you. Photos uploaded to Memories are stored in secure cloud storage. While we take reasonable measures to protect your information, no method of transmission over the internet is 100% secure.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">5. Data Retention and Deletion</h2>
            <p className="leading-relaxed">You may delete your account and all associated data at any time by contacting us at hello@rootedhomeschoolapp.com. We will process deletion requests within 30 days. Note that some information may be retained in encrypted backups for up to 90 days after deletion.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">6. Third-Party Services</h2>
            <p className="leading-relaxed">We use the following third-party services: Supabase (database and authentication), Vercel (hosting), and Anthropic Claude API (AI-powered features). Each of these services has their own privacy policies. We only share the minimum data necessary for these services to function.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">7. Contact Us</h2>
            <p className="leading-relaxed">If you have questions about this Privacy Policy or your data, please contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>. We are a small family-run company and will respond personally to every inquiry.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-[#e8e2d9] text-center">
          <p className="text-sm text-[#7a6f65]">Questions? <a href="/contact" className="text-[#5c7f63] hover:underline">Contact us</a> or email <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a></p>
        </div>
      </div>
    </main>
  )
}
