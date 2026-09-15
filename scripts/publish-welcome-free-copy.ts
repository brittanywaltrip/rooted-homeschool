/**
 * One-off: fix what the welcome email tells a brand-new family about her plan.
 *
 *   npx tsx scripts/publish-welcome-free-copy.ts          # PATCH + publish, prints the version id
 *   npx tsx scripts/publish-welcome-free-copy.ts --dry    # prints the before/after, calls nothing
 *
 * Never sends an email.
 *
 * The hosted rooted-welcome-free template said "You now have free access to
 * Rooted" and, in the footer, "You're on the free plan". Both are wrong on day
 * one: she has all of Rooted+ for 30 days. A mom who reads that email and then
 * finds unlimited photos and the full yearbook has been told the wrong thing
 * twice, and on day 31 it looks like a takeaway rather than the end of a trial.
 *
 * Two replacements, nothing else touched. Each must match exactly once in the
 * live published body or the script refuses (replaceExactlyOnce), so it can
 * never half-edit a template that has drifted.
 */
import { getTemplate, publishAndVerify, replaceExactlyOnce, resendCall } from './resend-templates-api.ts'
import { TEMPLATES } from '../lib/resend-template.ts'

export const WELCOME_OLD_ACCESS_SENTENCE = 'You now have free access to Rooted.'
export const WELCOME_NEW_ACCESS_SENTENCE =
  'You have 30 days of Rooted+, which is all of it: unlimited photos, the full yearbook, reports, and family sharing.'

export const WELCOME_OLD_FOOTER_HTML =
  "You're on the free plan. When you're ready, Rooted+ unlocks unlimited photos, your full family yearbook, curriculum pacing, and progress reports for $59 a year."
// The text version wraps, so the paragraph it replaces is matched with its line
// breaks exactly as Resend stores them.
export const WELCOME_OLD_FOOTER_TEXT =
  "You're on Rooted's free plan. Upgrade anytime\nhttps://rootedhomeschoolapp.com/upgrade to unlock unlimited memories, your\nfamily yearbook, and more."
export const WELCOME_NEW_FOOTER =
  'After your 30 days, the free plan keeps your planning, lessons, garden, and up to 50 photos. Rooted+ keeps everything else for $9.99 a month or $59 a year.'
// The plain-text footer keeps its upgrade link on its own line: a text-only
// reader has no button to tap.
export const WELCOME_NEW_FOOTER_TEXT = `${WELCOME_NEW_FOOTER}\nhttps://rootedhomeschoolapp.com/upgrade`

export function rewriteWelcomeHtml(html: string): string {
  const withAccess = replaceExactlyOnce(html, WELCOME_OLD_ACCESS_SENTENCE, WELCOME_NEW_ACCESS_SENTENCE, 'html access sentence')
  return replaceExactlyOnce(withAccess, WELCOME_OLD_FOOTER_HTML, WELCOME_NEW_FOOTER, 'html footer')
}

export function rewriteWelcomeText(text: string): string {
  const withAccess = replaceExactlyOnce(text, WELCOME_OLD_ACCESS_SENTENCE, WELCOME_NEW_ACCESS_SENTENCE, 'text access sentence')
  return replaceExactlyOnce(withAccess, WELCOME_OLD_FOOTER_TEXT, WELCOME_NEW_FOOTER_TEXT, 'text footer')
}

async function main() {
  const id = TEMPLATES.welcomeFree
  const current = await getTemplate(id)
  if (!current?.html || !current.text) throw new Error(`could not read template ${id}`)

  const html = rewriteWelcomeHtml(current.html)
  const text = rewriteWelcomeText(current.text)

  if (process.argv.includes('--dry')) {
    console.log('--- html ---\n' + html + '\n\n--- text ---\n' + text)
    return
  }

  const res = await resendCall('PATCH', `/templates/${id}`, { html, text })
  console.log(`PATCH /templates/${id} -> HTTP ${res.status}`)
  if (res.status >= 300) throw new Error(`PATCH refused: ${res.text}`)

  await publishAndVerify(id, [
    { mustInclude: [WELCOME_NEW_ACCESS_SENTENCE, WELCOME_NEW_FOOTER], mustExclude: [WELCOME_OLD_ACCESS_SENTENCE, WELCOME_OLD_FOOTER_HTML] },
    { field: 'text', mustInclude: [WELCOME_NEW_ACCESS_SENTENCE, WELCOME_NEW_FOOTER], mustExclude: [WELCOME_OLD_ACCESS_SENTENCE] },
  ])
}

if (process.argv[1] && process.argv[1].endsWith('publish-welcome-free-copy.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
