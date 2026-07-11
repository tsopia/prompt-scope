"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProject } from "@/contexts/ProjectContext";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { FirstRunScreen } from "@/components/FirstRunScreen";

/**
 * Sits inside ProjectProvider, wrapping the routed page content: once the
 * projects fetch has resolved (ProjectContext.loaded) and come back empty,
 * shows the first-run onboarding screen instead of page content. Never
 * flashes during the initial load — `loaded` stays false until the first
 * fetch settles.
 */
function ProjectGate({ children }: { children: React.ReactNode }) {
  const { projects, loaded } = useProject();
  if (loaded && projects.length === 0) return <FirstRunScreen />;
  return <>{children}</>;
}

/**
 * Gates the app shell behind auth.
 * - /login renders bare (no sidebar/menu) so unauthenticated users never see nav routes.
 * - While auth resolves, render nothing.
 * - Unauthenticated on a protected route → redirect to /login.
 * - Authenticated → render the sidebar shell around the page.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (!loading && !user && !isLoginPage) router.replace("/login");
  }, [loading, user, isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;
  if (loading) return null;
  if (!user) return null;

  return (
    <ProjectProvider>
      <SidebarProvider>
        <div className="flex h-screen bg-background">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto">
            <ProjectGate>{children}</ProjectGate>
          </main>
        </div>
      </SidebarProvider>
    </ProjectProvider>
  );
}
