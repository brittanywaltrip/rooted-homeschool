import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rooted Homeschool — Free Homeschool Planner",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
