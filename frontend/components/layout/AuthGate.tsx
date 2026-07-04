"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { AppSidebar } from "@/components/layout/AppSidebar";

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
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </ProjectProvider>
  );
}
