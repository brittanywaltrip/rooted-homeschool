import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: "noindex",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
