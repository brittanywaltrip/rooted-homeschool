import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora, Caveat } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import PostHogInit from "./components/PostHogInit";
import { Analytics } from '@vercel/analytics/react';
import Script from 'next/script';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

// Caveat — handwritten script used by the Plan print sheets (Daily/Week/
// Month). Loaded at the layout root so any printable surface can use it via
// the `font-handwritten` utility class without re-loading the family.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  display: "swap",
});

// SEO: full brand name in titles so brand searches ("rooted homeschool",
// "rooted homeschool app") resolve to us, not similarly named companies.
export const metadata: Metadata = {
  metadataBase: new URL("https://www.rootedhomeschoolapp.com"),
  applicationName: "Rooted Homeschool App",
  title: {
    default: "Rooted Homeschool App | Homeschool Planner, Memories & Yearbook",
    template: "%s | Rooted Homeschool App",
  },
  description: "Rooted is the homeschool app that plans your days, auto-adjusts when life happens, and turns your photos into a yearbook. Plan. Capture. Remember. Official site of the Rooted Homeschool App.",
  manifest: '/manifest.json',
  themeColor: '#5c7f63',
  openGraph: {
    title: "Rooted Homeschool App",
    description: "Rooted is the homeschool app that plans your days, auto-adjusts when life happens, and turns your photos into a yearbook. Plan. Capture. Remember. Official site of the Rooted Homeschool App.",
    url: "https://www.rootedhomeschoolapp.com",
    siteName: "Rooted Homeschool App",
    type: "website",
    images: ['https://www.rootedhomeschoolapp.com/images/og-image.png?v=4'],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rooted Homeschool App",
    description: "Rooted is the homeschool app that plans your days, auto-adjusts when life happens, and turns your photos into a yearbook. Plan. Capture. Remember. Official site of the Rooted Homeschool App.",
    images: ['https://www.rootedhomeschoolapp.com/images/og-image.png?v=4'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Rooted',
  },
  other: {
    'google-site-verification': 'cDzAlZ7R9GExF4LyE2aFbSb1eGl8FlSHvnWyaNiuLCg',
    'apple-itunes-app': 'app-id=6769627145',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Rooted" />
        <meta name="p:domain_verify" content="97ddc4e6613073bc3922371f423ad372" />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-QQPWDW5VZ6"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-QQPWDW5VZ6');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} ${caveat.variable} antialiased`}
      >
        {/* Structured data: tells Google exactly who we are, so brand
            searches distinguish us from similarly named companies. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: "Rooted Homeschool App",
                alternateName: "Rooted",
                url: "https://www.rootedhomeschoolapp.com",
                logo: "https://www.rootedhomeschoolapp.com/rooted-logo-nav.png",
                email: "hello@rootedhomeschoolapp.com",
                sameAs: [
                  "https://apps.apple.com/us/app/rooted-homeschool-app/id6769627145",
                  "https://www.instagram.com/rootedhomeschoolapp",
                ],
              },
              {
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                name: "Rooted Homeschool App",
                operatingSystem: "Web, iOS, Android",
                applicationCategory: "EducationalApplication",
                url: "https://www.rootedhomeschoolapp.com",
                sameAs: [
                  "https://apps.apple.com/us/app/rooted-homeschool-app/id6769627145",
                ],
                offers: [
                  { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free plan" },
                  { "@type": "Offer", price: "9.99", priceCurrency: "USD", description: "Rooted+ monthly" },
                  { "@type": "Offer", price: "59", priceCurrency: "USD", description: "Rooted+ annual" },
                ],
              },
            ]),
          }}
        />
        <ServiceWorkerRegistrar />
        <PostHogInit />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
