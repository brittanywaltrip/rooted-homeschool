// CLI wrapper around lib/audit-stripe-linkage.ts. Run with:
//   node --env-file=.env.local scripts/audit-stripe-linkage.ts
// Set AUDIT_JSON=1 for machine-readable output.

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

import { runStripeLinkageAudit } from '../lib/audit-stripe-linkage.ts'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function main() {
  console.log('[audit] running Stripe ↔ profile linkage audit…')
  const report = await runStripeLinkageAudit(stripe, supabase)

  if (process.env.AUDIT_JSON === '1') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('\n=== Stripe ↔ Profile linkage audit ===')
    console.log(`Stripe active/trialing subs: ${report.stripeActiveCount}`)
    console.log(`Paid profiles:                ${report.paidProfilesCount}`)
    console.log(`Issues found:                 ${report.issueCount}`)
    for (const issue of report.issues) {
      console.log(`\n[${issue.kind}]`)
      if (issue.userId) console.log(`  userId:         ${issue.userId}`)
      if (issue.customerId) console.log(`  customerId:     ${issue.customerId}`)
      if (issue.subscriptionId) console.log(`  subscriptionId: ${issue.subscriptionId}`)
      console.log(`  details:        ${issue.details}`)
    }
    console.log()
  }

  process.exit(report.issueCount === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[audit] fatal error:', err)
  process.exit(2)
})
