import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/CodeBlock";

const SDK_SNIPPET = `# pip install -e sdk/  （或将 sdk/ 加入 sys.path）
from promptscope import PromptScopeClient

client = PromptScopeClient("http://localhost:8000", "<你的 API Key>")

with client.trace("my-agent-run", input={"question": "今天天气如何？"}) as t:
    # tool_definitions 与完整 messages 是回放（replay）功能必需，务必如实上报
    t.llm(
        "plan",
        model="gpt-4o",
        messages=[{"role": "user", "content": "今天天气如何？"}],
        tool_definitions=[
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "查询指定城市的天气",
                    "parameters": {
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                    },
                },
            }
        ],
    )
    t.tool("get_weather", tool_input={"city": "北京"}, tool_output={"temp_c": 26})
    t.set_output({"answer": "北京今天 26°C，晴"})
`;

const STEPS = [
  {
    n: 1,
    title: "创建项目与 API Key",
    description: "在 Settings 中新建项目并生成一个 API Key，用于 SDK 上报鉴权。",
  },
  {
    n: 2,
    title: "接入 SDK 上报一条 trace",
    description: "在你的 Agent 代码中用 Python SDK 上报运行记录。",
  },
  {
    n: 3,
    title: "刷新查看",
    description: "上报完成后回到本页刷新，即可看到新的 trace。",
  },
];

export function OnboardingCard({
  projectName,
  onRefresh,
}: {
  projectName?: string;
  onRefresh?: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-6 py-8">
        <div>
          <p className="text-sm font-medium">
            {projectName ? `项目「${projectName}」` : "当前项目"}还没有任何 trace 数据
          </p>
          <p className="text-sm text-muted-foreground">按以下三步接入即可开始上报。</p>
        </div>

        <div className="space-y-5">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {STEPS[0].n}
            </span>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">{STEPS[0].title}</p>
              <p className="text-sm text-muted-foreground">{STEPS[0].description}</p>
              <Button asChild size="sm" variant="secondary">
                <Link href="/settings">前往 Settings</Link>
              </Button>
            </div>
          </div>

          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {STEPS[1].n}
            </span>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">{STEPS[1].title}</p>
              <p className="text-sm text-muted-foreground">{STEPS[1].description}</p>
              <CodeBlock code={SDK_SNIPPET} language="python" />
            </div>
          </div>

          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {STEPS[2].n}
            </span>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">{STEPS[2].title}</p>
              <p className="text-sm text-muted-foreground">{STEPS[2].description}</p>
              <Button size="sm" onClick={onRefresh}>
                我已上报，刷新
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
