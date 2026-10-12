// ===== src/shared/rules.ts =====
export type Mode = "solo" | "multi";
export type ShapeId = "few_big" | "mixed" | "many_small" | "no_small";
export type Curve = "linear" | "smooth" | "quad";
export type TailKind = "same3" | "same2" | "adj2";
export interface KnownGroup {
  products: number[];
  mult: number;
}

export interface PrimeEntry {
  p: number;
  base: number;
  kind: number;
  pick: number;
  unlock: number;
  rep: [n: number, s1: number, s2: number]; // c(k)=1+s1*min(k-1,n-1)+s2*max(0,k-n+1)
  ramp: { length: number; curve?: Curve };
}

export interface Rules {
  version: number;
  primes: PrimeEntry[];
  difficulty: {
    count: { perExtra: number };
    big: { from: number; perCount: number; perKind: number; cap: number };
    digit: { from: number; perDigit: number };
    known: KnownGroup[];
    tail: { kind: TailKind; mult: number }[]; // 先頭一致のみ適用
    excludeLast: { enabled: boolean; digitFull: boolean; scoreMult: number };
  };
  level: Record<Mode, { L0: number; perN: number; perSD: number; cap: number }>;
  gen: {
    rD: number;
    minFactors: number;
    maxFactors: number;
    maxTarget: number;
    maxRetry: number;
    pairPick: { a: number; b: number; mult: number }[];
    recent: { window: number; mult: number };
    avoid: { window: number };
    ramp: { floor: number };
    shapes: Record<ShapeId, { w: number; minLevel: number; floor: number; smallMult: number; bigMult: number }>;
  };
  score: {
    base: { kind: "pow"; a: number; k: number } | { kind: "anchor"; d1: number; s1: number; d2: number; s2: number } | { kind: "table"; table: number[] };
    perfect: { a: number; gamma: number; maxMult: number };
    chain: { by: "weight" | "count"; max: number; step: number };
    combo: Record<Mode, { kind: "time" | "mult"; every: number; add: number; max: number; onMiss: "zero" | "half" | "keep" }>;
    timeBuff: { fromD: number; texp: { a: number; gamma: number }; tiers: { ratio: number; mult: number }[] };
    miss: { mode: "geom" | "linear"; n: number; floor: number };
    totalMultCap: number;
    rounding: "floor" | "round";
  };
  time: Record<Mode, { limitSec: number }>;
  perfectOnly: boolean;
}

export const STANDARD: Rules = {
  version: 1,
  primes: [
    { p: 2, base: 1, kind: 0, pick: 6, unlock: 0, rep: [4, 0, 0.1], ramp: { length: 0 } },
    { p: 3, base: 1.5, kind: 0, pick: 6, unlock: 0, rep: [4, 0, 0.25], ramp: { length: 0 } },
    { p: 5, base: 1, kind: 0, pick: 6, unlock: 0, rep: [4, 0, 0.15], ramp: { length: 0 } },
    { p: 7, base: 2, kind: 0.5, pick: 6, unlock: 5, rep: [3, 0.05, 0.4], ramp: { length: 7, curve: "linear" } },
    { p: 11, base: 3, kind: 1, pick: 5, unlock: 7, rep: [3, 0.1, 0.6], ramp: { length: 8, curve: "linear" } },
    { p: 13, base: 4, kind: 1.5, pick: 5, unlock: 9, rep: [3, 0.1, 0.8], ramp: { length: 9, curve: "linear" } },
    { p: 17, base: 5, kind: 2, pick: 4, unlock: 11, rep: [3, 0.1, 1.0], ramp: { length: 11, curve: "linear" } },
    { p: 19, base: 6, kind: 2.5, pick: 4, unlock: 14, rep: [3, 0.1, 1.1], ramp: { length: 14, curve: "linear" } },
    { p: 23, base: 7, kind: 3, pick: 3.4, unlock: 17, rep: [2, 0.1, 1.2], ramp: { length: 17, curve: "linear" } },
    { p: 29, base: 8, kind: 3.5, pick: 3.2, unlock: 20, rep: [2, 0.1, 1.3], ramp: { length: 20, curve: "linear" } },
    { p: 31, base: 9, kind: 4, pick: 3, unlock: 23, rep: [2, 0.1, 1.4], ramp: { length: 24, curve: "linear" } },
    { p: 37, base: 10, kind: 4.5, pick: 2.8, unlock: 26, rep: [2, 0.1, 1.5], ramp: { length: 28, curve: "linear" } },
    { p: 41, base: 11, kind: 5, pick: 2.6, unlock: 29, rep: [2, 0.1, 1.6], ramp: { length: 32, curve: "linear" } },
    { p: 43, base: 12, kind: 5.5, pick: 2.4, unlock: 32, rep: [2, 0.1, 1.7], ramp: { length: 36, curve: "linear" } },
    { p: 47, base: 13, kind: 6, pick: 2.2, unlock: 35, rep: [2, 0.1, 1.8], ramp: { length: 40, curve: "linear" } },
    { p: 53, base: 14, kind: 6.5, pick: 2, unlock: 38, rep: [2, 0.1, 1.9], ramp: { length: 44, curve: "linear" } }
  ],
  difficulty: {
    count: { perExtra: 0.2 },
    big: { from: 17, perCount: 0.1, perKind: 0.1, cap: 0.6 },
    digit: { from: 5, perDigit: 0.1 },
    known: [
      // { products: [49, 121, 169, 289], mult: 0.8 },
      // { products: [25], mult: 0.5 },
      // { products: [299, 799, 899], mult: 0.95 },
      // { products: [343, 403], mult: 0.85 },
      // { products: [901, 1001, 2001], mult: 0.85 }
    ],
    tail: [
      { kind: "same3", mult: 0.95 },
      { kind: "same2", mult: 0.9 },
      { kind: "adj2", mult: 1.1 }
    ],
    excludeLast: { enabled: true, digitFull: true, scoreMult: 0.8 }
  },
  level: {
    solo: { L0: 6, perN: 0.3, perSD: 0.03, cap: 100 },
    multi: { L0: 6, perN: 1.0, perSD: 0, cap: 100 }
  },
  gen: {
    rD: 0.15,
    minFactors: 2,
    maxFactors: 15,
    maxTarget: 1000000000000000,
    maxRetry: 12,
    pairPick: [{ a: 2, b: 5, mult: 0.1 }],
    recent: { window: 3, mult: 0.9 },
    avoid: { window: 10 },
    ramp: { floor: 0.1 },
    shapes: {
      few_big: { w: 4, minLevel: 8, floor: 2, smallMult: 0.3, bigMult: 3 },
      mixed: { w: 4, minLevel: 0, floor: 2, smallMult: 1, bigMult: 1.5 },
      many_small: { w: 2, minLevel: 0, floor: 2, smallMult: 2, bigMult: 0.3 },
      no_small: { w: 1, minLevel: 10, floor: 5, smallMult: 1, bigMult: 1.5 }
    }
  },
  score: {
    base: { kind: "pow", a: 6.5, k: 1.7 },
    perfect: { a: 0.05, gamma: 1.3, maxMult: 10 },
    chain: { by: "weight", max: 0.7, step: 0.1 },
    combo: {
      solo: { kind: "time", every: 10, add: 1, max: 60, onMiss: "zero" },
      multi: { kind: "mult", every: 10, add: 0.05, max: 1.5, onMiss: "zero" }
    },
    timeBuff: {
      fromD: 10,
      texp: { a: 1.2, gamma: 0.7 },
      tiers: [
        { ratio: 0.5, mult: 1.3 },
        { ratio: 1, mult: 1.15 }
      ]
    },
    miss: { mode: "linear", n: 0.1, floor: 0.4 },
    totalMultCap: 100,
    rounding: "floor"
  },
  time: { solo: { limitSec: 100 }, multi: { limitSec: 100 } },
  perfectOnly: false
};

const DEV: Rules = { ...STANDARD, time: { solo: { limitSec: 10 }, multi: { limitSec: 10 } } };

export type Config = {
  showCountdown: boolean;
};

export type RuleSet = { id: string; name: string; ver: number; ranked: RankedRules; rules: Rules };

export enum RankedRules {
  Unranked = 0,
  RandomSeedOnly = 1
}

// 公式ルールセット。ranked のものだけランキング対象
export const RULESETS: Record<string, RuleSet> = {
  "normal-100s-v2": { id: "normal-100s-v2", name: "Normal 100s V2", ver: 1, ranked: RankedRules.RandomSeedOnly, rules: STANDARD }
  // dev: { id: "dev", name: "Dev", ver: 1, ranked: RankedRules.RandomSeedOnly, rules: DEV }
};
export const DEFAULT_ID = "normal-100s-v2";
export const DEFAULT_RULES = RULESETS[DEFAULT_ID].rules;
export const DEFAULT_CONFIG: Config = { showCountdown: false };

export type GameSetup = { ruleset: RuleSet; config: Config; seed: number; mode: Mode };
export const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

// リザルト（クライアント→サーバー）。申告値は score / solved のみ
export type Decision = { t: number; v: number[] }; // t: GOからの経過ms、v: その決定で判定に出した素数列
export type ProblemLog = { n: number; dec: Decision[] };
export type RunResult = { mode: string; rulesVer: number; seed: number; score: number; solved: number; problems: ProblemLog[] };

export function makeSetup(id: string, config: Config = DEFAULT_CONFIG, mode: Mode): GameSetup {
  const ruleset = RULESETS[id] ?? RULESETS[DEFAULT_ID];
  return { ruleset, config, seed: newSeed(), mode };
}
