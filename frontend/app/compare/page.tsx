"use client";

import { Suspense } from "react";
import { ComparePageContent } from "./ComparePageContent";

export const dynamic = "force-dynamic";

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">加载中...</div>}>
      <ComparePageContent />
    </Suspense>
  );
}
