export const API_BASE = "";

export interface Project {
  id: string;
  name: string;
}

export interface TraceSummary {
  id: string;
  name: string;
  origin: "live" | "replay";
  status: string;
  model_summary: string;
  observation_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number | null;
  latency_ms: number | null;
  started_at: string | null;
  created_at: string;
}

export interface TraceListResult {
  items: TraceSummary[];
  total: number;
}

export interface ObservationNode {
  id: string;
  parent_id: string | null;
  type: "llm" | "tool" | "span";
  name: string;
  seq: number;
  status: string;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  latency_ms: number | null;
  model: string | null;
  model_params: Record<string, unknown> | null;
  messages: Array<Record<string, unknown>> | null;
  tool_definitions: Array<Record<string, unknown>> | null;
  tool_calls: Array<Record<string, unknown>> | null;
  completion: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  tool_input: unknown;
  tool_output: unknown;
  children: ObservationNode[];
}

export interface TraceDetail {
  id: string;
  project_id: string;
  name: string;
  origin: "live" | "replay";
  status: string;
  input: unknown;
  output: unknown;
  started_at: string | null;
  ended_at: string | null;
  latency_ms: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number | null;
  created_at: string;
  observations: ObservationNode[];
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
  return resp.json();
}

export const api = {
  getProjects: () => get<Project[]>("/api/projects"),
  getTraces: (params: {
    projectId?: string;
    origin?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params.projectId) q.set("project_id", params.projectId);
    if (params.origin) q.set("origin", params.origin);
    if (params.search) q.set("search", params.search);
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return get<TraceListResult>(`/api/traces?${q.toString()}`);
  },
  getTrace: (id: string) => get<TraceDetail>(`/api/traces/${id}`),
};
