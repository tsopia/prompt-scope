import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptScope",
  description: "Agent 调优与回放平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#F9FAFB] text-[#1F2937]">{children}</body>
    </html>
  );
}
