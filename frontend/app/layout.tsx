import type { Metadata } from "next";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "PromptScope",
  description: "Agent 调优与回放平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#F9FAFB] text-[#1F2937] h-screen flex flex-col">
        <ProjectProvider>
          <TopBar />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </ProjectProvider>
      </body>
    </html>
  );
}
