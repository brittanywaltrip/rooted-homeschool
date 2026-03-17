export default function TermsPage() {
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
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Terms of Service</h1>
        <p className="text-sm text-[#b5aca4] mb-10">Last updated: March 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-[#5c5248]">
          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">1. Acceptance of Terms</h2>
            <p className="leading-relaxed">By creating an account and using Rooted Homeschool (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service. We may update these terms from time to time and will notify users of significant changes via email.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">2. Use of the Service</h2>
            <p className="leading-relaxed">Rooted Homeschool is designed for homeschooling families to track lessons, celebrate growth, and generate educational records. You agree to use the Service only for its intended purpose and in compliance with all applicable laws. You are responsible for maintaining the security of your account credentials.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">3. Beta Service</h2>
            <p className="leading-relaxed">Rooted Homeschool is currently in beta. This means the Service is still being developed and may contain bugs or experience downtime. Features may change without notice. We appreciate your patience and feedback during this period. Beta users receive access to the full app free of charge during the beta period.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">4. Your Content</h2>
            <p className="leading-relaxed">You retain ownership of all content you create in Rooted Homeschool, including lesson records, memories, reflections, and photos. By uploading content, you grant us a limited license to store and display that content within your account. We will never use your family&apos;s content for advertising or share it with third parties without your consent.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">5. Subscription and Payments</h2>
            <p className="leading-relaxed">During beta, the Service is free to use. When paid plans are introduced, we will provide clear advance notice of pricing and give existing users the opportunity to claim founding pricing. You will never be charged without explicit consent.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">6. Limitation of Liability</h2>
            <p className="leading-relaxed">Rooted Homeschool is provided &quot;as is&quot; without warranty of any kind. We are not liable for any loss of data, interruption of service, or other damages arising from your use of the Service. We strongly recommend keeping backup records of important educational documentation.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">7. Contact</h2>
            <p className="leading-relaxed">For questions about these Terms, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</p>
          </section>
        </div>
      </div>
    </main>
  )
}
