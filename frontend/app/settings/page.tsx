"use client";
import { useEffect, useState } from "react";
import { api, Pricing, Provider } from "@/lib/api";

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-[#E5E7EB] p-4 mb-6">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

const inputCls = "text-sm border border-[#E5E7EB] rounded-md px-2 py-1.5";

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pForm, setPForm] = useState({ name: "", base_url: "", api_key: "", provider_type: "openai" });
  const [prForm, setPrForm] = useState({ model: "", input: "", output: "", provider_id: "" });

  const reload = () => {
    api.getProviders().then(setProviders).catch((e) => setError(String(e)));
    api.getPricing().then(setPricing).catch((e) => setError(String(e)));
  };
  useEffect(reload, []);

  const addProvider = async () => {
    setError(null);
    try {
      await api.createProvider(pForm);
      setPForm({ name: "", base_url: "", api_key: "", provider_type: "openai" });
      reload();
    } catch (e) { setError(String(e)); }
  };

  const addPricing = async () => {
    setError(null);
    try {
      await api.createPricing({
        model: prForm.model,
        input_price_per_1k: parseFloat(prForm.input),
        output_price_per_1k: parseFloat(prForm.output),
        provider_id: prForm.provider_id || null,
      });
      setPrForm({ model: "", input: "", output: "", provider_id: "" });
      reload();
    } catch (e) { setError(String(e)); }
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h2 className="text-base font-semibold mb-4">设置</h2>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-4">{error}</div>}

      <SectionCard title="模型 Provider（回放与 Judge 调用凭证）">
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-[#E5E7EB]">
            <th className="py-1 pr-2">名称</th><th className="py-1 pr-2">Base URL</th>
            <th className="py-1 pr-2">类型</th><th className="py-1 pr-2">API Key</th><th></th>
          </tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className="border-b border-[#F3F4F6]">
                <td className="py-2 pr-2 font-medium">{p.name}</td>
                <td className="py-2 pr-2 text-gray-500">{p.base_url}</td>
                <td className="py-2 pr-2">{p.provider_type}</td>
                <td className="py-2 pr-2">{p.api_key_set ? "已配置" : "未配置"}</td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500"
                          onClick={() => api.deleteProvider(p.id).then(reload).catch((e) => setError(String(e)))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {providers.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">暂无 provider</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} placeholder="名称" value={pForm.name}
                 onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
          <input className={`${inputCls} w-72`} placeholder="Base URL（如 https://api.openai.com/v1）"
                 value={pForm.base_url}
                 onChange={(e) => setPForm({ ...pForm, base_url: e.target.value })} />
          <input className={inputCls} type="password" placeholder="API Key" value={pForm.api_key}
                 onChange={(e) => setPForm({ ...pForm, api_key: e.target.value })} />
          <select className={inputCls} value={pForm.provider_type}
                  onChange={(e) => setPForm({ ...pForm, provider_type: e.target.value })}>
            <option value="openai">openai 兼容</option>
            <option value="anthropic">anthropic</option>
          </select>
          <button onClick={addProvider}
                  className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50"
                  disabled={!pForm.name || !pForm.base_url || !pForm.api_key}>
            添加
          </button>
        </div>
      </SectionCard>

      <SectionCard title="模型定价（每 1K tokens 美元；配置 provider 后可作为 Judge 模型）">
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-[#E5E7EB]">
            <th className="py-1 pr-2">模型</th><th className="py-1 pr-2">Input</th>
            <th className="py-1 pr-2">Output</th><th className="py-1 pr-2">Provider</th><th></th>
          </tr></thead>
          <tbody>
            {pricing.map((r) => (
              <tr key={r.id} className="border-b border-[#F3F4F6]">
                <td className="py-2 pr-2 font-medium">{r.model}</td>
                <td className="py-2 pr-2 font-mono">${r.input_price_per_1k}</td>
                <td className="py-2 pr-2 font-mono">${r.output_price_per_1k}</td>
                <td className="py-2 pr-2 text-gray-500">
                  {providers.find((p) => p.id === r.provider_id)?.name ?? "—"}
                </td>
                <td className="py-2 text-right">
                  <button className="text-xs text-red-500"
                          onClick={() => api.deletePricing(r.id).then(reload).catch((e) => setError(String(e)))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {pricing.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">暂无定价</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} placeholder="模型名（如 gpt-4o）" value={prForm.model}
                 onChange={(e) => setPrForm({ ...prForm, model: e.target.value })} />
          <input className={inputCls} placeholder="Input $/1K" value={prForm.input}
                 onChange={(e) => setPrForm({ ...prForm, input: e.target.value })} />
          <input className={inputCls} placeholder="Output $/1K" value={prForm.output}
                 onChange={(e) => setPrForm({ ...prForm, output: e.target.value })} />
          <select className={inputCls} value={prForm.provider_id}
                  onChange={(e) => setPrForm({ ...prForm, provider_id: e.target.value })}>
            <option value="">无 provider</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addPricing}
                  className="text-sm px-3 py-1.5 rounded-md bg-[#6366F1] text-white disabled:opacity-50"
                  disabled={!prForm.model || !prForm.input || !prForm.output}>
            添加
          </button>
        </div>
      </SectionCard>
    </main>
  );
}
