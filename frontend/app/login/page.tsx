"use client";

import { useEffect, useState, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LoginAmbiencePanel } from "@/components/layout/LoginAmbiencePanel";

type Mode = "login" | "register";

// Logo + theme icons copied verbatim from docs/design/Login.dc.html (var(--accent)/
// currentColor stroke swapped to plain currentColor so they inherit token classes).
function LogoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <path
        d="M12 0.6V4.2M12 19.8V23.4M0.6 12H4.2M19.8 12H23.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7v6M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className="[animation:ps-spin_0.8s_linear_infinite]"
      {...props}
    >
      <path d="M12 3a9 9 0 109 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

const THEME_ICONS: Record<"light" | "dark" | "system", (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  light: (props) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (props) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  system: (props) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
};

const THEME_OPTS = [
  { key: "light" as const, tooltip: "浅色" },
  { key: "dark" as const, tooltip: "深色" },
  { key: "system" as const, tooltip: "跟随系统" },
];

function LoginThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex gap-0.5 rounded-md border border-border-soft bg-bg-grid p-0.5">
      {THEME_OPTS.map(({ key, tooltip }) => {
        const active = mounted && theme === key;
        const Icon = THEME_ICONS[key];
        return (
          <button
            key={key}
            type="button"
            title={tooltip}
            aria-label={tooltip}
            onClick={() => setTheme(key)}
            className={cn(
              "flex h-7 w-[30px] items-center justify-center rounded-[7px]",
              active ? "bg-surface-2 text-primary shadow-[inset_0_0_0_1px_hsl(var(--border))]" : "text-text-3 hover:text-foreground"
            )}
          >
            <Icon className="h-[15px] w-[15px]" />
          </button>
        );
      })}
    </div>
  );
}

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [allowRegister, setAllowRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLogin = mode === "login";

  useEffect(() => {
    api.getAuthConfig().then((c) => setAllowRegister(c.allow_registration)).catch(() => {});
  }, []);
  useEffect(() => {
    if (user) router.replace("/traces");
  }, [user, router]);

  const toggleMode = () => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (isLogin) await login(email, password);
      else await register(email, password, displayName);
      router.replace("/traces");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* ===== FORM (right, narrow) ===== */}
      <div className="relative order-2 flex basis-[clamp(380px,34%,470px)] flex-col border-l border-border px-11 py-10">
        <div className="flex items-center gap-2.5 text-primary">
          <LogoIcon />
          <span className="text-[17px] font-bold tracking-tight text-foreground">PromptScope</span>
        </div>

        <div className="absolute right-11 top-10">
          <LoginThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col justify-center">
          <div key={mode} className="[animation:ps-fade_0.22s_ease]">
            <h1 className="m-0 text-[23px] font-bold tracking-tight text-foreground">
              {isLogin ? "登录到你的工作区" : "创建你的账户"}
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              {isLogin ? "继续观测、回放与对比你的 agent 运行。" : "加入工作区，开始上报与调优 agent 链路。"}
            </p>

            {error && (
              <div className="mt-[22px] flex items-center gap-2.5 rounded-[10px] border border-destructive/35 bg-destructive/15 px-[13px] py-2.5">
                <AlertIcon className="shrink-0 text-fail-fg" />
                <span className="text-[12.5px] text-fail-fg">{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="mt-6 flex flex-col gap-[15px]">
              {!isLogin && (
                <div>
                  <label htmlFor="login-name" className="mb-[7px] block text-[12.5px] font-semibold text-muted-foreground">
                    显示名
                  </label>
                  <input
                    id="login-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="你在团队里的称呼"
                    className="h-[42px] w-full rounded-[10px] border border-border bg-card px-[13px] font-sans text-[13.5px] text-foreground outline-none focus:border-primary/40"
                  />
                </div>
              )}
              <div>
                <label htmlFor="login-email" className="mb-[7px] block text-[12.5px] font-semibold text-muted-foreground">
                  邮箱
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-[42px] w-full rounded-[10px] border border-border bg-card px-[13px] font-sans text-[13.5px] text-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-[7px] block text-[12.5px] font-semibold text-muted-foreground">
                  密码
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  minLength={isLogin ? undefined : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isLogin ? "••••••••" : "至少 8 位，含字母与数字"}
                  className="h-[42px] w-full rounded-[10px] border border-border bg-card px-[13px] font-sans text-[13.5px] text-foreground outline-none focus:border-primary/40"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className={cn(
                  "mt-1 flex h-11 w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary text-[14px] font-semibold text-primary-foreground",
                  busy ? "cursor-wait opacity-85" : "cursor-pointer"
                )}
              >
                {busy && <SpinnerIcon />}
                {busy ? (isLogin ? "登录中…" : "创建中…") : isLogin ? "登录" : "创建账户"}
              </button>
            </form>

            {allowRegister && (
              <p className="mt-6 text-center text-[13px] text-muted-foreground">
                {isLogin ? "还没有账号？" : "已经有账号了？"}{" "}
                <button type="button" onClick={toggleMode} className="font-semibold text-primary">
                  {isLogin ? "注册" : "去登录"}
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="text-center text-[11.5px] text-text-3">自托管 · v1.0 · 条款 · 隐私</div>
      </div>

      {/* ===== SIGNATURE AMBIENCE (left) ===== */}
      <LoginAmbiencePanel />
    </div>
  );
}
