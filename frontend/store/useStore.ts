import { create } from "zustand";
import { Candidate, CompareResult } from "@/lib/api";

interface AppState {
  candidates: Candidate[];
  selectedCandidates: string[];
  compareResult: CompareResult | null;
  sortBy: "cost" | "score" | "latency";
  sortOrder: "asc" | "desc";
  isLoading: boolean;
  error: string | null;

  setCandidates: (candidates: Candidate[]) => void;
  toggleCandidate: (id: string) => void;
  clearSelection: () => void;
  setCompareResult: (result: CompareResult | null) => void;
  setSortBy: (by: "cost" | "score" | "latency") => void;
  setSortOrder: (order: "asc" | "desc") => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  candidates: [],
  selectedCandidates: [],
  compareResult: null,
  sortBy: "cost",
  sortOrder: "asc",
  isLoading: false,
  error: null,

  setCandidates: (candidates) => set({ candidates }),
  toggleCandidate: (id) =>
    set((state) => {
      const selected = state.selectedCandidates.includes(id)
        ? state.selectedCandidates.filter((c) => c !== id)
        : state.selectedCandidates.length < 2
          ? [...state.selectedCandidates, id]
          : [state.selectedCandidates[1], id];
      return { selectedCandidates: selected };
    }),
  clearSelection: () => set({ selectedCandidates: [], compareResult: null }),
  setCompareResult: (result) => set({ compareResult: result }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortOrder: (sortOrder) => set({ sortOrder }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
