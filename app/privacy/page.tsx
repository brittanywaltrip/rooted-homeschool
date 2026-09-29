import { MarketingBackLink, MarketingLogo } from "@/app/components/MarketingHeaderLinks";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <MarketingBackLink />
        </div>
        <div className="flex items-center gap-3 mb-8">
          <MarketingLogo />
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Privacy Policy</h1>
        <p className="text-sm text-[#b5aca4] mb-10">Last updated: August 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-[#5c5248]">
          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">1. Information We Collect</h2>
            <p className="leading-relaxed">When you create an account, we collect information such as your family name, email address, and login credentials. You may enter children&apos;s names and avatar choices, educational records, memories, reflections, and photos. Optional features may also collect a child&apos;s full name, date of birth, graduation year, school name, and transcript details. Please do not upload Social Security numbers, payment card numbers, or government IDs to your family records.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">2. How We Use Your Information</h2>
            <p className="leading-relaxed">We use the information we collect to provide, maintain, and improve Rooted. This includes generating your family&apos;s progress reports, displaying your garden growth, and personalizing your experience based on your state. We do not sell your personal information to third parties. We do not use your data for advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">3. Children&apos;s Privacy (COPPA)</h2>
            <p className="leading-relaxed">Rooted is designed for use by parents and guardians to track their children&apos;s education. We are committed to complying with the Children&apos;s Online Privacy Protection Act (COPPA).</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li>A parent or guardian enters each child&apos;s information. Basic profiles include a name and avatar choice; optional records and features may contain more information as described in this policy. We do not ask children to provide their own contact information.</li>
              <li>If you use the transcript feature, you may enter the child&apos;s full name, date of birth, graduation year, school name, and related academic details. We use those details to create and store the records you request, subject to your sharing choices and the service providers described below.</li>
              <li>Photos uploaded by parents may contain children. We store them for the app features you use, including any family sharing you choose. Our storage and hosting providers process files to operate the service. We do not use your family photos in Rooted advertising without your permission.</li>
              <li>We do not knowingly collect personal information directly from children under 13. All data about children is entered and controlled exclusively by the parent or guardian account holder.</li>
              <li>Parents and guardians may review, update, or permanently delete all information about their children at any time through the Settings page or by contacting us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">4. Artificial Intelligence</h2>
            <p className="leading-relaxed">Your photos, your children&apos;s information, and everything you write inside Rooted are never used to train artificial intelligence. Not by us, and not by anyone else. We do not license, sell, or hand your family&apos;s content to any company for the purpose of training or improving an AI model.</p>
            <p className="leading-relaxed mt-2">To be concrete about what that means today: Rooted currently contains no AI features at all. There is no AI service connected to the app. Nothing you type, upload, or photograph is sent anywhere to be analyzed, summarized, or generated from. Your yearbook is assembled on your own device, from your own memories, with no outside service involved.</p>
            <p className="leading-relaxed mt-2">If we ever add a feature that uses AI, it will be optional, we will describe exactly what it does on this page before it launches, and the commitment above still holds: your family&apos;s photos, memories, and children&apos;s information will not be used to train AI models.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">5. Cookies and Local Storage</h2>
            <p className="leading-relaxed">Rooted uses browser local storage and session storage to manage your login session and remember your preferences (such as which resources you&apos;ve viewed). We also use a small number of analytics services to understand how families use the app so we can improve it. Those services are listed by name in the Third-Party Services section below, along with what each one can and cannot see.</p>
            <p className="leading-relaxed mt-2">What we do not do: we do not use advertising pixels, we do not do retargeting, and we do not sell or share your information for advertising of any kind.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">6. Data Storage and Security</h2>
            <p className="leading-relaxed">Your data is stored with Supabase, which is SOC 2 Type 2 and ISO 27001 certified and HIPAA compliant. Your database and files are hosted on Amazon Web Services in a United States region, encrypted with AES-256 at rest and protected by TLS in transit.</p>
            <p className="leading-relaxed mt-2">We use row-level security, which means the rules that keep your family&apos;s data separate from every other family&apos;s are enforced by the database itself rather than by app code that could be bypassed. Those rules cover both your records (lessons, memories, children, settings) and your uploaded files.</p>
            <p className="leading-relaxed mt-2">Photos and media you upload are stored in private cloud storage. When the app creates a time-limited link to display or share a file, anyone who receives that link may be able to open it until it expires. Keep shared links private if you do not want others to see the file.</p>
            <p className="leading-relaxed mt-2">One honest note about access. The people who operate Rooted hold administrative access to the database. This is what makes it possible to recover an account, fix a broken record, or investigate a bug you report. That access is used only for support you have asked for, or to diagnose a fault in the app. It is never used to browse your memories, and your content is never read for any other purpose.</p>
            <p className="leading-relaxed mt-2">In the event of a data breach that affects your personal information, we will notify affected users within 72 hours of discovering the breach via the email address associated with your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">7. Data Retention and Deletion</h2>
            <p className="leading-relaxed">You can request an account deletion from Settings. The deletion process removes account records and uploaded files from active systems. If a deletion step fails, some data may remain while we investigate and complete the request. Contact us if you encounter an error or need help confirming deletion. Backup copies and the limited deletion record described below may remain for the periods stated here.</p>
            <p className="leading-relaxed mt-2">We keep one small record of the deletion itself: your name, email address, plan, the date the account was created, and counts of how many memories, lessons, and children were on it. That record contains no photos, no memory content, and no information about your children beyond how many there were. It exists so we can answer questions like &quot;was my account really deleted?&quot;, honor billing and refund requests after the fact, and understand why families leave. If you would like that record removed as well, email us and we will delete it.</p>
            <p className="leading-relaxed mt-2">Some information may be retained in encrypted backups for up to 90 days after deletion, after which it is permanently purged. If you have questions or run into any issues, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">8. Third-Party Services</h2>
            <p className="leading-relaxed">We use the following third-party services to operate Rooted. Each has its own privacy policy, and we share only the minimum data necessary for each service to function:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Supabase</strong>: database, authentication, and file storage</li>
              <li><strong>Vercel</strong>: application hosting, deployment, and basic performance analytics (page load times)</li>
              <li><strong>Stripe</strong>: payment processing for Pro subscriptions. Stripe handles all payment data directly; we never store your full card number or payment credentials.</li>
              <li><strong>Resend</strong>: sending transactional emails (welcome, receipts, account notifications)</li>
              <li><strong>PostHog</strong>: product analytics, which may include an account identifier, page views, interactions, and session recordings, so we can understand use of Rooted and improve it. We are reviewing recording and masking settings to limit the personal content collected.</li>
              <li><strong>Google Analytics</strong>: aggregate usage statistics. Google Analytics does not access your photos, memory content, or children&apos;s information.</li>
              <li><strong>Open Library</strong>: when you type a book title in Rooted, we look it up through Open Library (openlibrary.org) to offer you the author, page count, and cover. The lookup happens from our server, not your browser, and the only thing sent is the title you typed. Nothing about you, your account, or your children goes with it.</li>
              <li><strong>Sentry</strong>: error monitoring, including diagnostic information and a replay when an error occurs. We configure ordinary session replay sampling to zero in the app. Error reports and replays may still contain information about the page and your interactions.</li>
            </ul>
            <p className="leading-relaxed mt-3"><strong>We do not sell your family content or use it for targeted advertising. The providers listed above process information needed to operate and improve Rooted.</strong></p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">9. If Rooted Is Ever Sold or Transferred</h2>
            <p className="leading-relaxed">Rooted is a small, family-run company, and we have no plans to sell it. But you deserve to know what would happen to your memories if that ever changed, so here is our commitment in writing:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li>We will email you before your information moves to anyone else, not after.</li>
              <li>You will have time to export everything and delete your account first, before any transfer takes place.</li>
              <li>Any company that acquires Rooted will be required to honor this policy for information collected before the transfer, including the artificial intelligence commitment in section 4.</li>
              <li>Your memories are never sold as an asset separate from the service itself. They are not a database to be sold off on their own.</li>
              <li>If Rooted ever shuts down, we will give you notice and a window to export your data before anything is deleted.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">10. California Residents (CCPA)</h2>
            <p className="leading-relaxed">If you are a California resident, you have the following rights under the California Consumer Privacy Act (CCPA):</p>
            <ul className="list-disc pl-5 mt-3 space-y-2 leading-relaxed">
              <li><strong>Right to Know:</strong> You may request a copy of the personal information we have collected about you.</li>
              <li><strong>Right to Delete:</strong> You may request that we delete your personal information, subject to certain exceptions.</li>
              <li><strong>Right to Opt Out of Sale:</strong> We do not sell your personal information to third parties, and we never will.</li>
            </ul>
            <p className="leading-relaxed mt-3">To exercise any of these rights, contact us at <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">hello@rootedhomeschoolapp.com</a>. We will respond within 45 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-[#2d2926] mb-3">11. Contact Us</h2>
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
