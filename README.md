This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

Required at runtime (set in `.env.local` for dev, Vercel project settings for staging/prod):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key for cron + webhook routes
- `STRIPE_SECRET_KEY` — Stripe API key
- `RESEND_API_KEY` — Resend API key for outbound email
- `RESEND_WEBHOOK_SECRET` — Resend webhook signing secret (`whsec_...`). Set this after adding `https://www.rootedhomeschoolapp.com/api/webhooks/resend` as a webhook endpoint in the Resend dashboard subscribed to `email.bounced` and `email.complained`. Without it the webhook returns 500.
- `RESEND_AUDIENCE_ID` — optional. When set, suppressed addresses are also pushed to Resend's audience as a defense-in-depth block. Leave unset to skip; suppressions still land in the `email_suppressions` table.
- `CRON_SECRET` — bearer token for Vercel cron auth

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
