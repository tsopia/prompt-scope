"use client";
import { useEffect, useState } from "react";
import { api, SyncStatus as SyncStatusType } from "@/lib/api";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncStatusProps {
  onSyncComplete: () => void;
}

export function SyncStatus({ onSyncComplete }: SyncStatusProps) {
  const [status, setStatus] = useState<SyncStatusType | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api.getSyncStatus().then(setStatus).catch(console.error);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.sync();
      const newStatus = await api.getSyncStatus();
      setStatus(newStatus);
      onSyncComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const timeAgo = status?.last_sync ? formatTimeAgo(new Date(status.last_sync)) : "从未";

  return (
    <div className="flex items-center gap-3">
      {status?.status === "mock" && (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
          Mock 数据
        </span>
      )}
      <span className="text-xs text-[#6B7280]">
        上次同步: {timeAgo} · {status?.count ?? 0} 条
      </span>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6B7280] border border-[#E5E7EB] rounded-lg hover:bg-[#F3F4F6] disabled:opacity-50 transition-colors"
      >
        <RotateCcw className={cn("h-3 w-3", syncing && "animate-spin")} />
        {syncing ? "同步中..." : "同步"}
      </button>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
