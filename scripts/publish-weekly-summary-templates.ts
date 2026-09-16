/**
 * One-off: rewrite the hosted `rooted-weekly-summary` template and create
 * `rooted-weekly-summary-quiet`, then publish both.
 *
 *   npx tsx scripts/publish-weekly-summary-templates.ts          # write, publish, print ids
 *   npx tsx scripts/publish-weekly-summary-templates.ts --dry    # print the payloads, call nothing
 *
 * Never sends an email.
 *
 * The old Monday email built one sentence from the TITLE of the first completed
 * lesson per child ("Last week: Zoe finished The Good and the Beautiful Math 3
 * - Lesson 43 and 2 photos saved."), and fell back to "Last week was a great
 * week of homeschooling." when it had nothing. The same rows, counted instead of
 * sampled, say what the family actually did. The quiet version goes to a family
 * who checked nothing off, and does not scold them for it.
 *
 * THE SPACE BETWEEN THE FIRST TWO LINES lives inside `memoriesLine`, not in the
 * template. A family with no memories gets an empty variable, and a template
 * that read `{{{lessonsLine}}} {{{memoriesLine}}}` would then render a trailing
 * space inside the paragraph and a line ending in a space in the text part.
 * lib/weekly-summary.ts's memoriesVariable() adds the leading space when there
 * is something to say, so what a reader sees is exactly the approved body.
 */
import { getTemplate, publishAndVerify, resendCall, type TemplateVariable } from './resend-templates-api.ts'
import { TEMPLATES } from '../lib/resend-template.ts'
import { WEEKLY_QUIET_SUBJECT } from '../lib/weekly-summary.ts'

export const WEEKLY_QUIET_ALIAS = 'rooted-weekly-summary-quiet'

export const WEEKLY_FULL_BODY = [
  'Hi {{{firstName}}},',
  '{{{lessonsLine}}}{{{memoriesLine}}}',
  '{{{gardenLine}}}',
] as const

export const WEEKLY_QUIET_BODY = [
  'Hi {{{firstName}}},',
  "Nothing was checked off in Rooted last week, and that's fine. Your plan is right where you left it, and Today will show what's next without making you catch up.",
  '{{{gardenLine}}}',
] as const

export const WEEKLY_BUTTON = 'Open Today'
export const WEEKLY_SIGNATURE = ['Brittany', 'Rooted Homeschool'] as const
export { WEEKLY_QUIET_SUBJECT }

const p = (s: string) => `<p>${s}</p>`

function html(body: readonly string[]): string {
  return (
    `<style>@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap');</style>` +
    `<div style="font-family: 'Crimson Pro', Georgia, serif; font-size: 20px; font-weight: 500; line-height: 1.7; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #2d2926; background: #fefcf9;">` +
    `<div style="text-align:center;margin-bottom:24px;"><img src="https://rootedhomeschoolapp.com/rooted-logo-nav.png" alt="Rooted" width="130" style="display:inline-block;" /></div>` +
    body.map(p).join('') +
    `<p style="text-align:center; margin: 32px 0;"><a href="{{{todayUrl}}}" style="background: #3d6b47; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px; display: inline-block;">${WEEKLY_BUTTON}</a></p>` +
    `<p>${WEEKLY_SIGNATURE[0]}<br /><span style="color:#7a6f65;">${WEEKLY_SIGNATURE[1]}</span></p>` +
    `<hr style="border: none; border-top: 1px solid #e8e2d9; margin: 32px 0;" />` +
    `<p style="font-size: 12px; color: #b5aca4; line-height: 1.6;">Rooted &middot; rootedhomeschoolapp.com &middot; Made with care for homeschool families. &middot; 732 S 6th Street, STE N, Las Vegas, NV 89101 &middot; <a href="{{{unsubscribeUrl}}}" style="color: #b5aca4;">Unsubscribe</a></p>` +
    `</div>`
  )
}

function text(body: readonly string[]): string {
  return [
    ...body,
    `${WEEKLY_BUTTON}: {{{todayUrl}}}`,
    WEEKLY_SIGNATURE.join('\n'),
    '--------------------------------------------------------------------------------',
    'Rooted · rootedhomeschoolapp.com · Made with care for homeschool families. · 732 S 6th Street, STE N, Las Vegas, NV 89101',
    'Want fewer emails? Unsubscribe: {{{unsubscribeUrl}}}',
  ].join('\n\n')
}

export const weeklyFullHtml = () => html(WEEKLY_FULL_BODY)
export const weeklyFullText = () => text(WEEKLY_FULL_BODY)
export const weeklyQuietHtml = () => html(WEEKLY_QUIET_BODY)
export const weeklyQuietText = () => text(WEEKLY_QUIET_BODY)

const COMMON_VARIABLES: TemplateVariable[] = [
  { key: 'firstName', type: 'string' },
  { key: 'gardenLine', type: 'string' },
  { key: 'todayUrl', type: 'string' },
  { key: 'unsubscribeUrl', type: 'string' },
]

export const WEEKLY_FULL_VARIABLES: TemplateVariable[] = [
  ...COMMON_VARIABLES,
  { key: 'lessonsLine', type: 'string' },
  { key: 'memoriesLine', type: 'string', fallback_value: '' },
]

export const WEEKLY_QUIET_VARIABLES: TemplateVariable[] = COMMON_VARIABLES

/**
 * What a reader sees: the hosted template with its variables filled in. Used by
 * the copy test to prove a blank memoriesLine leaves no stray space or line.
 */
export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{\{(\w+)\}\}\}/g, (_, key: string) => variables[key] ?? '')
}

async function main() {
  const full = {
    subject: 'Your week with Rooted',
    html: weeklyFullHtml(),
    text: weeklyFullText(),
    variables: WEEKLY_FULL_VARIABLES,
  }
  const quiet = {
    name: WEEKLY_QUIET_ALIAS,
    alias: WEEKLY_QUIET_ALIAS,
    subject: WEEKLY_QUIET_SUBJECT,
    html: weeklyQuietHtml(),
    text: weeklyQuietText(),
    variables: WEEKLY_QUIET_VARIABLES,
  }
  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify({ full, quiet }, null, 2))
    return
  }

  // 1. The existing template, rewritten in place: its id is already in
  //    lib/resend-template.ts and in five months of email_log history.
  const fullId = TEMPLATES.weeklySummary
  const patch = await resendCall('PATCH', `/templates/${fullId}`, full)
  console.log(`PATCH /templates/${fullId} -> HTTP ${patch.status}`)
  if (patch.status >= 300) throw new Error(`PATCH refused: ${patch.text}`)
  await publishAndVerify(fullId, [
    {
      mustInclude: ['{{{lessonsLine}}}{{{memoriesLine}}}', '{{{gardenLine}}}', 'href="{{{todayUrl}}}"'],
      mustExclude: ['{{{weeklySummary}}}', '{{{memoriesUrl}}}', 'Keep going', 'Every memory you capture'],
    },
    { field: 'text', mustInclude: ['Open Today: {{{todayUrl}}}'], mustExclude: ['{{{weeklySummary}}}'] },
  ])

  // 2. The quiet one, created by alias so a re-run updates it.
  const existing = await getTemplate(WEEKLY_QUIET_ALIAS)
  let quietId: string
  if (existing?.id) {
    quietId = existing.id
    const res = await resendCall('PATCH', `/templates/${quietId}`, quiet)
    console.log(`PATCH /templates/${quietId} -> HTTP ${res.status}`)
    if (res.status >= 300) throw new Error(`PATCH refused: ${res.text}`)
  } else {
    const res = await resendCall('POST', '/templates', quiet)
    console.log(`POST /templates -> HTTP ${res.status}`)
    if (res.status >= 300 || typeof res.json?.id !== 'string') throw new Error(`create refused: ${res.text}`)
    quietId = res.json.id
  }
  await publishAndVerify(quietId, [
    { mustInclude: ['Nothing was checked off in Rooted last week', '{{{gardenLine}}}', 'href="{{{todayUrl}}}"'] },
  ])
  console.log(`quiet template id: ${quietId}`)
  // The route posts to the hardcoded id. If this run wrote a DIFFERENT template
  // (a fresh account, or an alias pointing somewhere else), say so loudly rather
  // than leaving a published template nothing sends.
  if (quietId !== TEMPLATES.weeklySummaryQuiet) {
    throw new Error(
      `published ${quietId}, but TEMPLATES.weeklySummaryQuiet is ${TEMPLATES.weeklySummaryQuiet}. Update lib/resend-template.ts.`,
    )
  }
}

if (process.argv[1] && process.argv[1].endsWith('publish-weekly-summary-templates.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
