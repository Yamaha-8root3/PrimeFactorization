import { RunResult } from "./rules";

const BASE: string = import.meta.env.DEV ? "http://localhost:8787" : "";
const TOKEN_KEY = "pf.token";
export const RULES_VER = 1;

export type User = { id: number; username: string; displayName: string; role: string };
export type RankEntry = { rank: number; displayName: string; score: number; solved: number; mine: boolean };
export type RankMe = { rank: number; score: number; solved: number };

const rankCache = new Map<string, { t: number; data: { entries: RankEntry[]; me: RankMe | null } }>();
const RANK_TTL = 30_000;
export const clearRankCache = (mode?: string) => {
  for (const k of rankCache.keys()) if (!mode || k.startsWith(`${mode}:`)) rankCache.delete(k);
};

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const setToken = (t: string | null) => {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

async function call<T>(path: string, init: RequestInit = {}) {
  const token = getToken();
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } as T & { error?: string } };
  }
}

async function auth(path: "signup" | "login", body: Record<string, string>) {
  const r = await call<{ token: string; user: User }>(`/api/${path}`, { method: "POST", body: JSON.stringify(body) });
  if (r.ok) {
    setToken(r.data.token);
    return { user: r.data.user };
  }
  return { error: r.data.error ?? "network" };
}
export const signup = (username: string, password: string, displayName?: string) => auth("signup", { username, password, ...(displayName ? { displayName } : {}) });
export const login = (username: string, password: string) => auth("login", { username, password });

export async function logout() {
  await call("/api/logout", { method: "POST" });
  setToken(null);
}
export async function fetchMe(): Promise<User | null> {
  if (!getToken()) return null;
  const r = await call<{ user: User }>("/api/me");
  if (r.ok) return r.data.user;
  if (r.status === 401) setToken(null); // 期限切れ・無効なトークンは破棄
  return null;
}

export async function changePassword(current: string, next: string) {
  const r = await call<{ token: string }>("/api/password", { method: "POST", body: JSON.stringify({ current, next }) });
  if (r.ok) {
    setToken(r.data.token);
    return {};
  } // 全端末のセッションが破棄されるため、新しいトークンに差し替える
  return { error: r.data.error ?? "network" };
}

export async function submitScore(result: RunResult) {
  const r = await call<{ best: number; isBest: boolean }>("/api/score", {
    method: "POST",
    body: JSON.stringify(result)
  });
  if (r.ok) clearRankCache(result.mode);
  return r.ok ? r.data : { error: r.data.error ?? "network" };
}

export async function fetchRanking(mode: string, limit = 20) {
  const k = `${mode}:${limit}`;
  const hit = rankCache.get(k);
  if (hit && Date.now() - hit.t < RANK_TTL) return hit.data;
  const r = await call<{ entries: RankEntry[]; me: RankMe | null }>(`/api/ranking?mode=${encodeURIComponent(mode)}&limit=${limit}`);
  if (!r.ok) return { error: r.data.error ?? "network" };
  rankCache.set(k, { t: Date.now(), data: r.data });
  console.log(r.data);
  return r.data;
}
export async function fetchBests() {
  const r = await call<{ bests: Record<string, number> }>("/api/best");
  return r.ok ? r.data : { error: r.data.error ?? "network" };
}
