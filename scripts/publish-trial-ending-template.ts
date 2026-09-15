/**
 * One-off: create (or update) and publish the hosted `rooted-trial-ending`
 * template.
 *
 *   npx tsx scripts/publish-trial-ending-template.ts          # create or PATCH, publish, print id + version
 *   npx tsx scripts/publish-trial-ending-template.ts --dry    # print the payload, call nothing
 *
 * Never sends an email. Looks the template up by alias first, so a second run
 * updates the same template instead of creating a duplicate.
 *
 * Every new family gets 30 days of Rooted+, and nothing told them it was ending.
 * The copy says plainly what stays and what changes. Every number in it is
 * asserted against the code in scripts/publish-trial-ending-template.test.ts, so
 * a limit that moves fails the tests before the email can say something false.
 *
 * Same wrapper as rooted-winback: Crimson Pro, logo, green button, footer with
 * the Las Vegas address, unsubscribe link. The sending route
 * (app/api/cron/trial-ending/route.ts) sets the subject; the template carries the
 * same subject so a preview in the Resend dashboard reads the same.
 */
import { getTemplate, publishAndVerify, resendCall, type TemplateVariable } from './resend-templates-api.ts'

export const TRIAL_ENDING_ALIAS = 'rooted-trial-ending'

export const TRIAL_ENDING_SUBJECT = 'Your Rooted+ trial ends {{{endDate}}}'

// The approved copy. The button sits between the price paragraph and the "If
// not" paragraph, where the brief puts it.
export const TRIAL_ENDING_BEFORE_BUTTON = [
  'Hi {{{firstName}}},',
  "You've had all of Rooted+ for the last few weeks, and it ends on {{{endDate}}}. Here is what that means, plainly.",
  "What stays: your plan, every lesson you've checked off, {{{who}}}'s garden, and every memory you've captured. Nothing is deleted. Today, Plan, and lesson logging keep working exactly as they do now.",
  'What changes on the free plan: the Memories page shows the last 30 days, photos are capped at 50, the yearbook shows the first four spreads, and transcripts, PDF reports, and family sharing are set aside until you upgrade. Everything older stays saved and comes back the moment you do.',
  'If Rooted has earned a spot in your school year, Rooted+ is $9.99 a month or $59 a year.',
] as const

export const TRIAL_ENDING_BUTTON = 'Keep Rooted+'

export const TRIAL_ENDING_AFTER_BUTTON = [
  "If not, no hard feelings, and you don't need to do anything. If something got in the way, reply and tell me; I read every one.",
] as const

export const TRIAL_ENDING_SIGNATURE = ['Brittany', 'Rooted Homeschool'] as const

const p = (s: string) => `<p>${s}</p>`

export function trialEndingHtml(): string {
  return (
    `<style>@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap');</style>` +
    `<div style="font-family: 'Crimson Pro', Georgia, serif; font-size: 20px; font-weight: 500; line-height: 1.7; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #2d2926; background: #fefcf9;">` +
    `<div style="text-align:center;margin-bottom:24px;"><img src="https://rootedhomeschoolapp.com/rooted-logo-nav.png" alt="Rooted" width="130" style="display:inline-block;" /></div>` +
    TRIAL_ENDING_BEFORE_BUTTON.map(p).join('') +
    `<p style="text-align:center; margin: 32px 0;"><a href="{{{upgradeUrl}}}" style="background: #3d6b47; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px; display: inline-block;">${TRIAL_ENDING_BUTTON}</a></p>` +
    TRIAL_ENDING_AFTER_BUTTON.map(p).join('') +
    `<p>${TRIAL_ENDING_SIGNATURE[0]}<br /><span style="color:#7a6f65;">${TRIAL_ENDING_SIGNATURE[1]}</span></p>` +
    `<hr style="border: none; border-top: 1px solid #e8e2d9; margin: 32px 0;" />` +
    `<p style="font-size: 12px; color: #b5aca4; line-height: 1.6;">Rooted &middot; rootedhomeschoolapp.com &middot; Made with care for homeschool families. &middot; 732 S 6th Street, STE N, Las Vegas, NV 89101</p>` +
    `<p style="text-align: center; font-size: 12px; color: #b5aca4; margin-top: 24px;">Want fewer emails? <a href="https://rootedhomeschoolapp.com/unsubscribe?email={{{email}}}" style="color: #b5aca4;">Unsubscribe</a></p>` +
    `</div>`
  )
}

export function trialEndingText(): string {
  return [
    ...TRIAL_ENDING_BEFORE_BUTTON,
    `${TRIAL_ENDING_BUTTON}: {{{upgradeUrl}}}`,
    ...TRIAL_ENDING_AFTER_BUTTON,
    TRIAL_ENDING_SIGNATURE.join('\n'),
    '--------------------------------------------------------------------------------',
    'Rooted · rootedhomeschoolapp.com · Made with care for homeschool families. · 732 S 6th Street, STE N, Las Vegas, NV 89101',
    'Want fewer emails? Unsubscribe: https://rootedhomeschoolapp.com/unsubscribe?email={{{email}}}',
  ].join('\n\n')
}

export const TRIAL_ENDING_VARIABLES: TemplateVariable[] = [
  { key: 'firstName', type: 'string' },
  { key: 'endDate', type: 'string' },
  { key: 'who', type: 'string', fallback_value: 'your family' },
  { key: 'upgradeUrl', type: 'string' },
  { key: 'email', type: 'string' },
]

async function main() {
  const payload = {
    name: TRIAL_ENDING_ALIAS,
    alias: TRIAL_ENDING_ALIAS,
    subject: TRIAL_ENDING_SUBJECT,
    html: trialEndingHtml(),
    text: trialEndingText(),
    variables: TRIAL_ENDING_VARIABLES,
  }
  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  const existing = await getTemplate(TRIAL_ENDING_ALIAS)
  let id: string
  if (existing?.id) {
    id = existing.id
    const res = await resendCall('PATCH', `/templates/${id}`, payload)
    console.log(`PATCH /templates/${id} -> HTTP ${res.status}`)
    if (res.status >= 300) throw new Error(`PATCH refused: ${res.text}`)
  } else {
    const res = await resendCall('POST', '/templates', payload)
    console.log(`POST /templates -> HTTP ${res.status}`)
    if (res.status >= 300 || typeof res.json?.id !== 'string') throw new Error(`create refused: ${res.text}`)
    id = res.json.id
  }

  await publishAndVerify(id, [
    {
      mustInclude: [
        'it ends on {{{endDate}}}',
        "{{{who}}}'s garden",
        '$9.99 a month or $59 a year',
        'href="{{{upgradeUrl}}}"',
      ],
    },
    { field: 'text', mustInclude: ['Keep Rooted+: {{{upgradeUrl}}}'] },
  ])
}

if (process.argv[1] && process.argv[1].endsWith('publish-trial-ending-template.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
