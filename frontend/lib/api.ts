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

export interface Evaluation {
  id: string;
  subject_trace_id: string;
  compare_trace_id: string | null;
  judge_model: string;
  context_mode: string;
  score: number | null;
  score_b: number | null;
  verdict: string | null;
  reasoning: string | null;
  cost: number | null;
  created_at: string;
}

export interface JudgeRunResult {
  judge_model: string;
  status: "ok" | "error";
  evaluation: Evaluation | null;
  error: string | null;
}

export interface Divergence {
  type: string;
  tool?: string;
  step: number;
  recorded_input?: unknown;
  actual_input?: unknown;
  arguments?: unknown;
}

export interface ReplayRun {
  id: string;
  source_trace_id: string;
  result_trace_id: string | null;
  status: string;
  override_model: string | null;
  override_model_params: Record<string, unknown> | null;
  override_prompt_text: string | null;
  override_prompt_version_id: string | null;
  divergences: Divergence[] | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface PromptSummary {
  id: string;
  name: string;
  version_count: number;
  latest_version: number;
  created_at: string;
}

export interface PromptVersionInfo {
  id: string;
  version: number;
  content: string;
  created_at: string;
}

export interface PromptDetail {
  id: string;
  name: string;
  project_id: string;
  versions: PromptVersionInfo[];
}

export interface VersionTrace {
  id: string;
  name: string;
  origin: string;
  total_cost: number | null;
  created_at: string;
}

export interface ApiKeyInfo {
  id: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyCreated {
  id: string;
  prefix: string;
  key: string;
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
  getEvaluations: (subjectId: string, compareId?: string) => {
    const q = new URLSearchParams({ subject_trace_id: subjectId });
    if (compareId) q.set("compare_trace_id", compareId);
    return get<Evaluation[]>(`/api/evaluations?${q.toString()}`);
  },
  evaluate: (body: { subject_trace_id: string; compare_trace_id?: string; judge_models: string[]; force?: boolean }) =>
    send<{ results: JudgeRunResult[] }>("POST", "/api/evaluations", body),
  createReplay: (body: {
    source_trace_id: string;
    target_observation_id?: string;
    override_model?: string;
    override_model_params?: Record<string, unknown>;
    override_prompt_text?: string;
    override_prompt_version_id?: string;
  }) => send<ReplayRun>("POST", "/api/replays", body),
  getReplays: (sourceTraceId: string) =>
    get<ReplayRun[]>(`/api/replays?source_trace_id=${encodeURIComponent(sourceTraceId)}`),
  getPrompts: (projectId: string) =>
    get<PromptSummary[]>(`/api/prompts?project_id=${encodeURIComponent(projectId)}`),
  createPrompt: (body: { project_id: string; name: string; content: string }) =>
    send<PromptDetail>("POST", "/api/prompts", body),
  getPrompt: (id: string) => get<PromptDetail>(`/api/prompts/${id}`),
  addPromptVersion: (id: string, content: string) =>
    send<PromptVersionInfo>("POST", `/api/prompts/${id}/versions`, { content }),
  getVersionTraces: (versionId: string) =>
    get<VersionTrace[]>(`/api/prompt-versions/${versionId}/traces`),
  createProject: (body: { name: string }) =>
    send<Project & { created_at: string }>("POST", "/api/projects", body),
  getProjectKeys: (projectId: string) =>
    get<ApiKeyInfo[]>(`/api/projects/${projectId}/keys`),
  createProjectKey: (projectId: string) =>
    send<ApiKeyCreated>("POST", `/api/projects/${projectId}/keys`),
  revokeKey: (keyId: string) =>
    send<{ revoked: boolean }>("DELETE", `/api/keys/${keyId}`),
};
