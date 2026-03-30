export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#b5aca4] mb-10">Last updated: March 2026</p>

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
              <li>We collect only children&apos;s first names, entered by a parent or guardian. We do not collect last names, birthdates, photos of children, or any other identifying information about minors.</li>
              <li>We do not knowingly collect personal information directly from children under 13. All data about children is entered and controlled exclusively by the parent or guardian account holder.</li>
              <li>Parents and guardians may review, update, or permanently delete all information about their children at any time through the Settings page or by contacting us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">4. AI-Generated Content</h2>
            <p className="leading-relaxed">Some features of Rooted — including Family Update narratives and Graduation letters — are generated with the assistance of artificial intelligence (Anthropic&apos;s Claude API). When you use these features, limited data (such as lesson counts, book titles, and child name) may be sent to Anthropic to generate your content. This data is used solely to produce your requested output and is not used to train AI models.</p>
            <p className="leading-relaxed mt-2">AI-generated content is provided for personal, reflective use. It may contain inaccuracies and should be reviewed by you before sharing. We are not responsible for the accuracy of AI-generated text.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">5. Cookies and Local Storage</h2>
            <p className="leading-relaxed">Rooted uses browser local storage and session storage to manage your login session and remember your preferences (such as which resources you&apos;ve viewed). We do not use third-party tracking cookies, advertising pixels, or analytics services that share your data with external companies. Our use of local storage is limited to making the app work for you.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">6. Data Storage and Security</h2>
            <p className="leading-relaxed">Your data is stored securely using Supabase, a trusted database platform with industry-standard encryption at rest and in transit. We use row-level security policies to ensure your family&apos;s data is accessible only to you. Photos are stored in secure cloud storage. While we take all reasonable measures to protect your information, no method of internet transmission is 100% secure.</p>
            <p className="leading-relaxed mt-2">In the event of a data breach that affects your personal information, we will notify affected users within 72 hours of discovering the breach via the email address associated with your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">7. Data Retention and Deletion</h2>
            <p className="leading-relaxed">You may delete your account and all associated data at any time by contacting us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>. We will process deletion requests within 30 days. Some information may be retained in encrypted backups for up to 90 days after deletion, after which it is permanently purged.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">8. Third-Party Services</h2>
            <p className="leading-relaxed">We use the following third-party services to operate Rooted. Each has its own privacy policy, and we share only the minimum data necessary for each service to function:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Supabase</strong> — database, authentication, and file storage</li>
              <li><strong>Vercel</strong> — application hosting and deployment</li>
              <li><strong>Stripe</strong> — payment processing for Pro subscriptions. Stripe handles all payment data directly; we never store your full card number or payment credentials.</li>
              <li><strong>Anthropic (Claude API)</strong> — AI-powered narrative generation for Family Updates and Graduation Slideshows</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">9. California Residents (CCPA)</h2>
            <p className="leading-relaxed">If you are a California resident, you have the following rights under the California Consumer Privacy Act (CCPA):</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Right to Know:</strong> You may request a copy of the personal information we have collected about you.</li>
              <li><strong>Right to Delete:</strong> You may request that we delete your personal information, subject to certain exceptions.</li>
              <li><strong>Right to Opt Out of Sale:</strong> We do not sell your personal information to third parties, and we never will.</li>
            </ul>
            <p className="leading-relaxed mt-3">To exercise any of these rights, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>. We will respond within 45 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">10. Contact Us</h2>
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
