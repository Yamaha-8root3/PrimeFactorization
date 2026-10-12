// src/shared/storage.ts
import { RULESETS } from "./rules";
import { fetchBests, clearRankCache } from "./api";

const key = (id: string) => `pf.best.${id}.${RULESETS[id]?.ver}${owner ? "." + owner : ""}`;
const mem = new Map<string, number>(); // ログイン中のサーバー側ベスト
let owner: number | null = null; // null = ゲスト
const subs = new Set<() => void>();
export const onBest = (fn: () => void) => void subs.add(fn);

const readLocal = (id: string) => {
  try {
    return Number(localStorage.getItem(key(id))) || 0;
  } catch {
    return 0;
  }
};

// ログイン状態が変わったときに呼ぶ。ログイン中はサーバーから1回だけ取得
export async function syncBest(userId: number | null) {
  owner = userId;
  mem.clear();
  clearRankCache();
  if (userId !== null) {
    const r = await fetchBests();
    if ("bests" in r) for (const [id, s] of Object.entries(r.bests)) mem.set(id, s);
  }
  subs.forEach((f) => f());
}

const isGuest = () => owner === null;
const isUnranked = (id: string) => !RULESETS[id]?.ranked;

export const loadBest = (id: string) => {
  if (isGuest()) return readLocal(id);
  return mem.get(id) || readLocal(id);
};

export function saveBest(id: string, v: number) {
  try {
    localStorage.setItem(key(id), String(v));
  } catch {}
}
