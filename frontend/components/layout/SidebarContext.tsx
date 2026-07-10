"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "promptscope.sidebarCollapsed";

interface SidebarCtx {
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false,
  toggleCollapsed: () => {},
});

/**
 * Shared collapsed/expanded state for the app sidebar. Lifted above both
 * AppSidebar (renders the rail) and PageHeader (renders the collapse
 * toggle button, per the design's page-header pattern) so either can
 * read/flip it. Persists to the same localStorage key the sidebar always
 * used, so existing behavior/tests relying on that key are unaffected.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return <Ctx.Provider value={{ collapsed, toggleCollapsed }}>{children}</Ctx.Provider>;
}

export const useSidebar = () => useContext(Ctx);
