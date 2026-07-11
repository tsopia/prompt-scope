"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useProject } from "@/contexts/ProjectContext";
import { LogoIcon } from "@/components/layout/AppSidebar";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Project } from "@/lib/api";

// Rendered by AuthGate (in place of page content) when an authenticated
// user's project list has loaded and come back empty — see
// ProjectContext.loaded. Sidebar stays visible around this; only the
// <main> content area is replaced.
export function FirstRunScreen() {
  const { refreshProjects, setCurrentProject } = useProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleCreated = async (p: Project) => {
    await refreshProjects();
    setCurrentProject(p);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProjects();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <LogoIcon className="h-9 w-9 text-primary" />
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">创建你的第一个项目</h2>
            <p className="text-sm text-muted-foreground">
              PromptScope 以项目为工作区：agent 上报的链路、提示词与配置都归属于项目。你可以创建一个新项目，或等待同事把你邀请进已有项目。
            </p>
          </div>
          <Button className="w-full gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>已被邀请？刷新试试</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              刷新
            </Button>
          </div>
        </CardContent>
      </Card>
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </div>
  );
}
