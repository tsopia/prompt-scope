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

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const data = await resp.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep status */ }
    throw new Error(detail);
  }
  return resp.json();
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  provider_type: "openai" | "anthropic";
  api_key_set: boolean;
  created_at: string;
}

export interface Pricing {
  id: string;
  model: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
  provider_id: string | null;
}

export interface JudgeModel {
  model: string;
  provider_name: string;
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
  getProviders: () => get<Provider[]>("/api/providers"),
  createProvider: (body: { name: string; base_url: string; api_key: string; provider_type: string }) =>
    send<Provider>("POST", "/api/providers", body),
  deleteProvider: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/providers/${id}`),
  getPricing: () => get<Pricing[]>("/api/pricing"),
  createPricing: (body: { model: string; input_price_per_1k: number; output_price_per_1k: number; provider_id?: string | null }) =>
    send<Pricing>("POST", "/api/pricing", body),
  deletePricing: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/pricing/${id}`),
  getJudgeModels: () => get<JudgeModel[]>("/api/judge-models"),
};
