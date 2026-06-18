const API_BASE = "";

export interface Candidate {
  id: string;
  experiment_id: string;
  input: string;
  prompt_id: string;
  prompt_version?: number;
  model: string;
  output: string;
  cost: number;
  latency: number;
  score?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface CompareResult {
  candidate_a: string;
  candidate_b: string;
  replaceable: boolean;
  score_a: number;
  score_b: number;
  cost_diff: number;
  reason: string;
  from_cache?: boolean;
}

export interface SyncStatus {
  last_sync: string | null;
  count: number;
  status: string;
}

async function fetcher<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getCandidates: () => fetcher<Candidate[]>("/api/candidates"),
  getExperiments: () => fetcher<Record<string, Candidate[]>>("/api/experiments"),
  compare: (candidateA: string, candidateB: string) =>
    fetcher<CompareResult>("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_a: candidateA, candidate_b: candidateB }),
    }),
  sync: () => fetcher<{ message: string; count: number }>("/api/sync", { method: "POST" }),
  getSyncStatus: () => fetcher<SyncStatus>("/api/sync/status"),
};
