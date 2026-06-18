"use client";

import { Suspense } from "react";
import { CandidatesPageContent } from "./CandidatesPageContent";

export default function CandidatesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">加载中...</div>}>
      <CandidatesPageContent />
    </Suspense>
  );
}
