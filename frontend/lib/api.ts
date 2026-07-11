export const API_BASE = "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Project {
  id: string;
  name: string;
  summary_model: string | null;
}

export interface ReplaySource {
  source_trace_id: string;
  source_trace_name?: string;
  override_model?: string;
  thinking?: boolean;
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
  divergence_count: number;
  summary: string | null;
  input_preview: string | null;
  replay_source: ReplaySource | null;
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
  metadata: Record<string, unknown> | null;
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
  metadata: Record<string, unknown> | null;
  divergence_count: number;
  summary: string | null;
  observations: ObservationNode[];
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!resp.ok) throw new ApiError(resp.status, `GET ${path} failed: ${resp.status}`);
  return resp.json();
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const data = await resp.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch { /* keep status */ }
    throw new ApiError(resp.status, detail);
  }
  return resp.json();
}

export interface Provider {
  id: string;
  name: string;
  base_url: string;
  provider_type: "openai" | "anthropic";
  kind: "official" | "aggregator" | null;
  note: string | null;
  api_key_set: boolean;
  created_at: string;
  project_id: string | null;
}

export interface Pricing {
  id: string;
  model: string;
  input_price_per_1k: number;
  output_price_per_1k: number;
  provider_id: string | null;
  project_id: string | null;
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
  result_cost: number | null;
  result_latency_ms: number | null;
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
  name: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface ApiKeyCreated {
  id: string;
  prefix: string;
  name: string | null;
  key: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  auth_source: string;
}

export interface AuthConfig {
  allow_registration: boolean;
}

export interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: "owner" | "member";
  created_at: string;
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
  getProviders: (projectId: string) =>
    get<Provider[]>(`/api/providers?project_id=${encodeURIComponent(projectId)}`),
  createProvider: (body: {
    name: string;
    base_url: string;
    api_key: string;
    provider_type: string;
    kind?: string;
    note?: string | null;
    project_id: string;
  }) => send<Provider>("POST", "/api/providers", body),
  updateProvider: (
    id: string,
    body: {
      name: string;
      base_url: string;
      api_key?: string;
      provider_type: string;
      kind?: string;
      note?: string | null;
      project_id: string;
    }
  ) => send<Provider>("PUT", `/api/providers/${id}`, body),
  deleteProvider: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/providers/${id}`),
  getPricing: (projectId: string) =>
    get<Pricing[]>(`/api/pricing?project_id=${encodeURIComponent(projectId)}`),
  createPricing: (body: { model: string; input_price_per_1k: number; output_price_per_1k: number; provider_id?: string | null; project_id: string }) =>
    send<Pricing>("POST", "/api/pricing", body),
  updatePricing: (id: string, body: { model: string; input_price_per_1k: number; output_price_per_1k: number; provider_id?: string | null }) =>
    send<Pricing>("PUT", `/api/pricing/${id}`, body),
  deletePricing: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/pricing/${id}`),
  getJudgeModels: (projectId: string) =>
    get<JudgeModel[]>(`/api/judge-models?project_id=${encodeURIComponent(projectId)}`),
  getEvaluations: (subjectId: string, compareId?: string) => {
    const q = new URLSearchParams({ subject_trace_id: subjectId });
    if (compareId) q.set("compare_trace_id", compareId);
    return get<Evaluation[]>(`/api/evaluations?${q.toString()}`);
  },
  evaluate: (body: { subject_trace_id: string; compare_trace_id?: string; judge_models: string[]; context_mode?: string; force?: boolean }) =>
    send<{ results: JudgeRunResult[] }>("POST", "/api/evaluations", body),
  createReplay: (body: {
    source_trace_id: string;
    target_observation_id?: string;
    override_model?: string;
    override_model_params?: Record<string, unknown>;
    override_prompt_text?: string;
    override_prompt_version_id?: string;
  }) => send<ReplayRun>("POST", "/api/replays", body),
  getReplay: (id: string) => get<ReplayRun>(`/api/replays/${id}`),
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
  // PUT /api/projects/{id}：name 后端 ProjectRename 仍是必填字段（不是 name?），
  // summary_model 才是真正可选/可显式置 null 的字段（不出现在请求体 -> 保持不变；
  // 显式传 null -> 清空）。renameProject 保留作为向后兼容别名（仅改名，summary_model
  // 字段不出现在请求体中，后端保持其原值不变）。
  updateProject: (id: string, body: { name: string; summary_model?: string | null }) =>
    send<Project & { created_at: string }>("PUT", `/api/projects/${id}`, body),
  renameProject: (id: string, name: string) => api.updateProject(id, { name }),
  getProjectKeys: (projectId: string) =>
    get<ApiKeyInfo[]>(`/api/projects/${projectId}/keys`),
  createProjectKey: (projectId: string, name?: string) =>
    send<ApiKeyCreated>("POST", `/api/projects/${projectId}/keys`, name ? { name } : undefined),
  revokeKey: (keyId: string) =>
    send<{ revoked: boolean }>("DELETE", `/api/keys/${keyId}`),

  // Auth
  getMe: () => get<CurrentUser>("/api/auth/me"),
  getAuthConfig: () => get<AuthConfig>("/api/auth/config"),
  login: (body: { email: string; password: string }) =>
    send<CurrentUser>("POST", "/api/auth/login", body),
  register: (body: { email: string; password: string; display_name: string }) =>
    send<CurrentUser>("POST", "/api/auth/register", body),
  logout: () => send<{ logged_out: boolean }>("POST", "/api/auth/logout"),

  // Members
  getMembers: (projectId: string) =>
    get<Member[]>(`/api/projects/${projectId}/members`),
  addMember: (projectId: string, email: string) =>
    send<Member[]>("POST", `/api/projects/${projectId}/members`, { email }),
  removeMember: (projectId: string, userId: string) =>
    send<{ removed: boolean }>("DELETE", `/api/projects/${projectId}/members/${userId}`),
};
