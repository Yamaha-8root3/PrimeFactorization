export const prod = (a: number[]) => a.reduce((x, y) => x * y, 1);

// 使える素因数の候補（段階的に解放）
export const PRIME_POOL = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

// 重みは仮値（29 以降は増加幅を約 0.2〜0.4 として外挿した想定）
const PRIME_W: Record<number, number> = {
  2: 0.5,
  3: 0.8,
  5: 0.7,
  7: 1.5,
  11: 1.4,
  13: 1.8,
  17: 2.2,
  19: 2.4,
  23: 2.8,
  29: 3.2,
  31: 3.4,
  37: 3.8,
  41: 4.1,
  43: 4.3,
  47: 4.6,
  53: 5.0
};

// [進行度(score/PT)の閾値, 解放される素数の上限]
const UNLOCK: [number, number][] = [
  [0, 5],
  [4, 7],
  [8, 11],
  [12, 13],
  [17, 17],
  [22, 19],
  [28, 23],
  [34, 29],
  [40, 31],
  [46, 37],
  [53, 41],
  [60, 43],
  [67, 47],
  [75, 53]
];
const DIFF = { count: 0.3, repeat: 0.6, digit: 0.4, pairNerf: 1.0, pair: 0.15 };
const big = (p: number) => Math.max(0, Math.log2(p / 5));
const RANGE = {
  dMax0: 3.4, // 初期の難易度上限（据え置き）
  width: 1.5,
  fast: 0.35, // 序盤の上昇量 / 進行単位（旧 0.6）
  fastUntil: 10, // 序盤の終わり（旧 8）
  slow: 0.2 // 序盤以降（旧 0.3）
};

const PT = 25;

export function difficulty(f: number[]): number {
  const cnt = new Map<number, number>();
  let d = 0;
  for (const p of f) {
    const c = cnt.get(p) ?? 0;
    d += (PRIME_W[p] ?? Math.log2(p)) * (c === 0 ? 1 : DIFF.repeat) + DIFF.count;
    cnt.set(p, c + 1);
  }
  d += (String(prod(f)).length - 1) * DIFF.digit;
  d -= Math.min(cnt.get(2) ?? 0, cnt.get(5) ?? 0) * DIFF.pairNerf;
  // 大きい素因数どうしの組み合わせ加算
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) d += big(f[i]) * big(f[j]) * DIFF.pair;
  return Math.max(0, d);
}

export type Stage = { dMin: number; dMax: number; maxPrime: number };

// 進行度(正解数)ごとの出題範囲
export function stageOf(score: number): Stage {
  const s = score / PT; // 従来の「正解数」相当の連続値
  const f = Math.min(s, RANGE.fastUntil);
  const dMax = RANGE.dMax0 + f * RANGE.fast + Math.max(0, s - RANGE.fastUntil) * RANGE.slow;
  const maxPrime = UNLOCK.filter(([t]) => s >= t).pop()![1];
  return { dMin: Math.max(0, dMax - RANGE.width), dMax, maxPrime };
}

export type Problem = { n: number; factors: number[]; d: number; stage: Stage };

let lastN = 0;

// 範囲内に収まるまで乱択。失敗時は範囲に最も近いものを返す
export function generate(solved: number): Problem {
  const stage = stageOf(solved);
  const pool = PRIME_POOL.filter((p) => p <= stage.maxPrime);
  let best: Problem | null = null;
  let bestGap = Infinity;
  for (let t = 0; t < 300; t++) {
    const k = 1 + Math.floor(Math.random() * 8);
    const factors = Array.from({ length: k }, () => pool[Math.floor(Math.random() * pool.length)]);
    const n = prod(factors);
    if (n === lastN) continue;
    const d = difficulty(factors);
    const gap = d < stage.dMin ? stage.dMin - d : d > stage.dMax ? d - stage.dMax : 0;
    const p: Problem = { n, factors, d, stage };
    if (gap === 0) {
      lastN = n;
      return p;
    }
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  best ??= { n: 2, factors: [2], d: difficulty([2]), stage };
  lastN = best.n;
  return best;
}

export function progressOf(d: number): number {
  return Math.max(1, Math.round(d * 10));
}
