import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptScope - LLM 对比与成本优化",
  description: "基于 Langfuse 的 LLM 对比与成本优化平台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
      </body>
    </html>
  );
}
