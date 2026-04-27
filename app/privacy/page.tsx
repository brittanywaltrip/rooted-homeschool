export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <a href="/" className="text-sm text-[#5c7f63] hover:underline">← Back to Rooted</a>
        </div>
        <div className="flex items-center gap-3 mb-8">
          <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: '36px', width: 'auto' }} />
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#b5aca4] mb-10">Last updated: April 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-[#5c5248]">
          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">1. Information We Collect</h2>
            <p className="leading-relaxed">We collect information you provide directly to us when you create an account, including your family name, email address, and password. We also collect information about your children (first names and avatar colors only, entered by you as a parent or guardian) and the educational content you log within the app — lessons, books, memories, reflections, and photos. We do not collect sensitive personal information such as Social Security numbers, financial data, or government IDs.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">2. How We Use Your Information</h2>
            <p className="leading-relaxed">We use the information we collect to provide, maintain, and improve Rooted. This includes generating your family&apos;s progress reports, displaying your garden growth, and personalizing your experience based on your state. We do not sell your personal information to third parties. We do not use your data for advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">3. Children&apos;s Privacy (COPPA)</h2>
            <p className="leading-relaxed">Rooted is designed for use by parents and guardians to track their children&apos;s education. We are committed to complying with the Children&apos;s Online Privacy Protection Act (COPPA).</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li>We collect only children&apos;s first names and avatar colors, entered by a parent or guardian. We do not collect children&apos;s last names, birthdates, contact information, or any other identifying information about minors.</li>
              <li>Photos uploaded by parents may contain children. These photos are uploaded entirely at the parent&apos;s discretion, stored privately within the parent&apos;s account, never used for advertising, and never shared with any third party. Parents may delete any photo at any time from within the app.</li>
              <li>We do not knowingly collect personal information directly from children under 13. All data about children is entered and controlled exclusively by the parent or guardian account holder.</li>
              <li>Parents and guardians may review, update, or permanently delete all information about their children at any time through the Settings page or by contacting us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">4. Cookies and Local Storage</h2>
            <p className="leading-relaxed">Rooted uses browser local storage and session storage to manage your login session and remember your preferences (such as which resources you&apos;ve viewed). We do not use third-party tracking cookies, advertising pixels, or analytics services that share your data with external companies. Our use of local storage is limited to making the app work for you.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">5. Data Storage and Security</h2>
            <p className="leading-relaxed">Your data is stored securely using Supabase, a trusted database platform with industry-standard encryption at rest and in transit. We use row-level security policies on our database so your family&apos;s lessons, memories, and account data are accessible only to you.</p>
            <p className="leading-relaxed mt-2">Photos and media you upload are stored in private cloud storage. Photo URLs require authentication and expire on a rolling basis — they cannot be viewed by anyone outside the app without a fresh, time-limited token issued for that specific request.</p>
            <p className="leading-relaxed mt-2">In the event of a data breach that affects your personal information, we will notify affected users within 72 hours of discovering the breach via the email address associated with your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">6. Data Retention and Deletion</h2>
            <p className="leading-relaxed">You may export all your data or permanently delete your account and all associated data at any time directly from the Settings page within the app. Account deletion takes effect immediately when you confirm in Settings. Some information may be retained in encrypted backups for up to 90 days after deletion, after which it is permanently purged. If you have questions or run into any issues, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">7. Third-Party Services</h2>
            <p className="leading-relaxed">We use the following third-party services to operate Rooted. Each has its own privacy policy, and we share only the minimum data necessary for each service to function:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Supabase</strong> — database, authentication, and file storage</li>
              <li><strong>Vercel</strong> — application hosting, deployment, and basic performance analytics (page load times)</li>
              <li><strong>Stripe</strong> — payment processing for Pro subscriptions. Stripe handles all payment data directly; we never store your full card number or payment credentials.</li>
              <li><strong>Resend</strong> — sending transactional emails (welcome, receipts, account notifications)</li>
              <li><strong>PostHog</strong> — product analytics (anonymous usage data such as page views and clicks) so we can understand how families use Rooted and improve the experience. PostHog does not access your photos, memory content, or children&apos;s information.</li>
              <li><strong>Google Analytics</strong> — aggregate usage statistics. Google Analytics does not access your photos, memory content, or children&apos;s information.</li>
            </ul>
            <p className="leading-relaxed mt-3"><strong>None of our analytics or third-party services are used for advertising. We do not sell, share, or rent your personal information to anyone, ever.</strong></p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">8. California Residents (CCPA)</h2>
            <p className="leading-relaxed">If you are a California resident, you have the following rights under the California Consumer Privacy Act (CCPA):</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Right to Know:</strong> You may request a copy of the personal information we have collected about you.</li>
              <li><strong>Right to Delete:</strong> You may request that we delete your personal information, subject to certain exceptions.</li>
              <li><strong>Right to Opt Out of Sale:</strong> We do not sell your personal information to third parties, and we never will.</li>
            </ul>
            <p className="leading-relaxed mt-3">To exercise any of these rights, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>. We will respond within 45 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">9. Contact Us</h2>
            <p className="leading-relaxed">If you have questions about this Privacy Policy or your data, please contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>. We are a small, family-run company and will respond personally to every inquiry.</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-[#e8e2d9] text-center">
          <p className="text-sm text-[#7a6f65]">Questions? <a href="/contact" className="text-[#5c7f63] hover:underline">Contact us</a> or email <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a></p>
        </div>
      </div>
    </main>
  )
}
