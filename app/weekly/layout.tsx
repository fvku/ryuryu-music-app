import type { Metadata } from "next";

export const metadata: Metadata = { title: "今週のリリース作業" };

export default function WeeklyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
