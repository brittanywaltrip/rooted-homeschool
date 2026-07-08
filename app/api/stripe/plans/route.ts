import { NextResponse } from 'next/server'

// Reports which optional paid plans are configured in this environment, so
// the upgrade UI can hide an option whose Stripe price id is missing rather
// than render a button that would fail at checkout. Derived from the same
// STRIPE_*_PRICE_ID env vars the checkout route reads, never a hardcoded id.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    monthly: Boolean(process.env.STRIPE_MONTHLY_PRICE_ID),
  })
}
