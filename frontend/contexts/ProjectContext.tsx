"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api, Project } from "@/lib/api";

interface ProjectCtx {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project) => void;
  refreshProjects: () => Promise<void>;
}

const Ctx = createContext<ProjectCtx>({
  projects: [],
  currentProject: null,
  setCurrentProject: () => {},
  refreshProjects: async () => {},
});

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrent] = useState<Project | null>(null);

  const setCurrentProject = (p: Project) => {
    setCurrent(p);
    localStorage.setItem("promptscope.projectId", p.id);
  };

  const refreshProjects = async () => {
    const list = await api.getProjects();
    setProjects(list);
    setCurrent((prev) => {
      if (prev && list.some((p) => p.id === prev.id)) return prev;
      const savedId = localStorage.getItem("promptscope.projectId");
      return list.find((p) => p.id === savedId) ?? list[0] ?? null;
    });
  };

  useEffect(() => {
    refreshProjects().catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ projects, currentProject, setCurrentProject, refreshProjects }}>
      {children}
    </Ctx.Provider>
  );
}

export const useProject = () => useContext(Ctx);
