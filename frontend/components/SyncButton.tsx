"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";

interface SyncButtonProps {
  onSync?: () => void;
}

export function SyncButton({ onSync }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.sync();
      onSync?.();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
      {syncing ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      同步数据
    </Button>
  );
}
