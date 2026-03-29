export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <a href="/" className="text-sm text-[#5c7f63] hover:underline">← Back to Rooted</a>
        </div>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-xl bg-[#5c7f63] flex items-center justify-center text-base">🌿</div>
          <span className="font-bold text-[#2d2926]">Rooted</span>
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Terms of Service</h1>
        <p className="text-sm text-[#b5aca4] mb-10">Last updated: March 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-[#5c5248]">
          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">1. Acceptance of Terms</h2>
            <p className="leading-relaxed">By creating an account and using Rooted (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service. We may update these terms from time to time and will notify users of significant changes via email.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">2. Acceptable Use</h2>
            <p className="leading-relaxed">Rooted is designed for homeschooling families to track lessons, celebrate growth, and generate educational records. By using the Service, you agree to:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li>Use the Service only for personal, non-commercial, homeschool-related purposes. Commercial use is not permitted.</li>
              <li>Maintain one account per family. Creating multiple accounts to circumvent any limits or restrictions is prohibited.</li>
              <li>Not scrape, crawl, or systematically extract data from the Service.</li>
              <li>Not upload or share illegal content, including but not limited to content that infringes copyright, contains malware, or violates any applicable law.</li>
              <li>Maintain the security of your account credentials and notify us immediately of any unauthorized access.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">3. Subscriptions and Payments</h2>
            <p className="leading-relaxed">Rooted Pro is an annual subscription. By subscribing, you agree to the following:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Billing:</strong> You will be charged the annual subscription fee at the time of purchase. All payments are processed securely by Stripe.</li>
              <li><strong>Auto-Renewal:</strong> Your subscription renews automatically each year on your billing anniversary date. We will send you a reminder email 7 days before your renewal date. You may cancel at any time in your account Settings before the renewal date to avoid being charged.</li>
              <li><strong>Refunds:</strong> Annual subscriptions are refundable within 14 days of the original purchase date. After 14 days, no refunds will be issued for the current subscription period. To request a refund within the 14-day window, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</li>
              <li><strong>Cancellation:</strong> Canceling your subscription stops future renewals. You retain access to Pro features through the end of your current paid period.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">4. Your Content</h2>
            <p className="leading-relaxed">You retain ownership of all content you create in Rooted, including lesson records, memories, reflections, and photos. By uploading content, you grant us a limited license to store and display that content within your account. We will never use your family&apos;s content for advertising or share it with third parties without your consent.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">5. AI-Generated Content</h2>
            <p className="leading-relaxed">Some features of Rooted — including Family Update narratives and Graduation letters — are generated with artificial intelligence. AI-generated content is provided for personal, reflective use only. It may contain inaccuracies, errors, or content that does not accurately reflect your family&apos;s experience. You should review all AI-generated content before sharing it with others. Rooted is not responsible for the accuracy or completeness of AI-generated text.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">6. Resources and Brand Disclaimer</h2>
            <p className="leading-relaxed">The Resources section of Rooted includes links to discounts, field trips, and educational materials from third-party brands and retailers. Rooted has no affiliation with, endorsement from, or partnership with any brands or retailers mentioned in the Resources section. Discounts, offers, and links are curated for informational purposes only and are subject to change without notice. Always verify current terms and availability directly with the retailer or provider.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">7. Limitation of Liability</h2>
            <p className="leading-relaxed">Rooted is provided &quot;as is&quot; without warranty of any kind. We are not liable for any loss of data, interruption of service, or other damages arising from your use of the Service. We strongly recommend keeping backup records of important educational documentation outside of Rooted.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">8. Dispute Resolution</h2>
            <p className="leading-relaxed">Any dispute arising from or relating to these Terms or your use of the Service will be resolved by binding individual arbitration in the state of Nevada, in accordance with the rules of the American Arbitration Association. <strong>You waive any right to participate in a class action lawsuit or class-wide arbitration.</strong> Nothing in this section prevents either party from seeking injunctive or other equitable relief for violations of intellectual property rights.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">9. Contact</h2>
            <p className="leading-relaxed">For questions about these Terms, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-[#e8e2d9] text-center">
          <p className="text-sm text-[#7a6f65]">Questions? <a href="/contact" className="text-[#5c7f63] hover:underline">Contact us</a> or email <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a></p>
        </div>
      </div>
    </main>
  )
}
