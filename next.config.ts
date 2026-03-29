import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "gvkbegvvmhcrmxdorctk.supabase.co",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/more/faq",
        destination: "/faq",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
