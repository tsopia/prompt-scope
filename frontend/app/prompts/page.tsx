"use client";

import { FileText } from "lucide-react";

export default function PromptsPage() {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="bg-white border-b border-[#E5E7EB] px-6 py-3">
        <h1 className="text-xl font-bold text-[#1F2937]">提示词管理</h1>
      </header>
      <div className="p-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-12 text-center">
          <FileText className="h-12 w-12 text-[#D1D5DB] mx-auto mb-4" />
          <p className="text-sm text-[#6B7280]">提示词管理功能开发中...</p>
        </div>
      </div>
    </div>
  );
}
