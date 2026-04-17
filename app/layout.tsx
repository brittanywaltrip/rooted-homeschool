import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Rooted",
  description: "Capture. Plan. Remember. — Rooted is the homeschool companion that helps you plan your days, capture the moments, and hold onto it all.",
  manifest: '/manifest.json',
  themeColor: '#5c7f63',
  openGraph: {
    title: "Rooted",
    description: "Capture. Plan. Remember. — Rooted is the homeschool companion that helps you plan your days, capture the moments, and hold onto it all.",
    url: "https://rootedhomeschoolapp.com",
    siteName: "Rooted",
    type: "website",
    images: ['https://rootedhomeschoolapp.com/images/og-image.png?v=4'],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rooted",
    description: "Capture. Plan. Remember. — Rooted is the homeschool companion that helps you plan your days, capture the moments, and hold onto it all.",
    images: ['https://rootedhomeschoolapp.com/images/og-image.png?v=4'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Rooted',
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
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} antialiased`}
      >
        <ServiceWorkerRegistrar />
        <PostHogInit />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
