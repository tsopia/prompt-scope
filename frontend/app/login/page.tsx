"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [allowRegister, setAllowRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAuthConfig().then((c) => setAllowRegister(c.allow_registration)).catch(() => {});
  }, []);
  useEffect(() => {
    if (user) router.replace("/traces");
  }, [user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, displayName);
      router.replace("/traces");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "login" ? "登录 PromptScope" : "注册账号"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <Input type="email" placeholder="邮箱" value={email} required
                   onChange={(e) => setEmail(e.target.value)} />
            {mode === "register" && (
              <Input placeholder="显示名" value={displayName}
                     onChange={(e) => setDisplayName(e.target.value)} />
            )}
            <Input type="password" placeholder="密码（至少 8 位）" value={password} required
                   minLength={8} onChange={(e) => setPassword(e.target.value)} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
            </Button>
          </form>
          {allowRegister && (
            <button type="button" className="mt-3 text-sm text-muted-foreground underline"
                    onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
