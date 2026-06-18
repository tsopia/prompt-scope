"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FlaskConical,
  ClipboardList,
  FileText,
  Settings,
  Target,
  Cpu,
  Crown,
} from "lucide-react";

const menuItems = [
  { icon: FlaskConical, label: "实验工作台", href: "/" },
  { icon: ClipboardList, label: "实验记录", href: "/experiments" },
  { icon: FileText, label: "提示词管理", href: "/prompts" },
  { icon: Cpu, label: "模型管理", href: "/models" },
  { icon: Target, label: "评估标准", href: "/evaluation" },
  { icon: Settings, label: "设置", href: "/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] bg-white border-r border-[#E5E7EB] flex flex-col z-50">
      <div className="px-5 py-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-[#6366F1]" />
          <span className="text-lg font-bold text-[#1F2937]">PromptScope</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-[#6366F1] text-white"
                  : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937]"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[#E5E7EB]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-xs font-bold">
            ZS
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#1F2937] truncate">Zhampt San</p>
            <div className="flex items-center gap-1">
              <Crown className="h-3 w-3 text-[#F59E0B]" />
              <span className="text-xs text-[#6366F1] font-medium">Pro</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
