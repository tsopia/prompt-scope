import type { Metadata } from "next";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "PromptScope",
  description: "Agent 调优与回放平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="h-screen flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <ProjectProvider>
            <div className="flex h-screen bg-background">
              <AppSidebar />
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </ProjectProvider>
          <Toaster richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
