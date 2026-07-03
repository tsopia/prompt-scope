"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api, Project } from "@/lib/api";

interface ProjectCtx {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (p: Project) => void;
}

const Ctx = createContext<ProjectCtx>({
  projects: [],
  currentProject: null,
  setCurrentProject: () => {},
});

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrent] = useState<Project | null>(null);

  useEffect(() => {
    api.getProjects().then((list) => {
      setProjects(list);
      const savedId = localStorage.getItem("promptscope.projectId");
      setCurrent(list.find((p) => p.id === savedId) ?? list[0] ?? null);
    }).catch(() => setProjects([]));
  }, []);

  const setCurrentProject = (p: Project) => {
    setCurrent(p);
    localStorage.setItem("promptscope.projectId", p.id);
  };

  return (
    <Ctx.Provider value={{ projects, currentProject, setCurrentProject }}>
      {children}
    </Ctx.Provider>
  );
}

export const useProject = () => useContext(Ctx);
