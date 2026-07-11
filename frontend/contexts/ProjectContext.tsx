"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api, Project } from "@/lib/api";

interface ProjectCtx {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project) => void;
  refreshProjects: () => Promise<void>;
  // True once the initial (or any subsequent) projects fetch has resolved —
  // lets consumers (e.g. the first-run onboarding screen) distinguish
  // "still loading" from "loaded and genuinely empty" and avoid a flash.
  loaded: boolean;
}

const Ctx = createContext<ProjectCtx>({
  projects: [],
  currentProject: null,
  setCurrentProject: () => {},
  refreshProjects: async () => {},
  loaded: false,
});

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrent] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);

  const setCurrentProject = (p: Project) => {
    setCurrent(p);
    localStorage.setItem("promptscope.projectId", p.id);
  };

  const refreshProjects = async () => {
    try {
      const list = await api.getProjects();
      setProjects(list);
      setCurrent((prev) => {
        if (prev) {
          const updated = list.find((p) => p.id === prev.id);
          if (updated) return updated;
        }
        const savedId = localStorage.getItem("promptscope.projectId");
        return list.find((p) => p.id === savedId) ?? list[0] ?? null;
      });
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    refreshProjects().catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ projects, currentProject, setCurrentProject, refreshProjects, loaded }}>
      {children}
    </Ctx.Provider>
  );
}

export const useProject = () => useContext(Ctx);
