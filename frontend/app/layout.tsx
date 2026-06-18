import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 ml-[220px]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
