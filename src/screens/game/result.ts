import { Mode, RuleSet } from "../../shared/rules";

export type Rec = {
  no: number;
  n: number;
  factors: number[];
  d: number; // 難易度
  ms: number; // 回答時間
  miss: number;
  perfect: boolean;
  base: number; // 基礎点（コンボ・PERFECT 倍率を掛ける前の合計）
  pts: number; // 実際に得た得点
  done: boolean; // false = 時間切れで未完了
  submits: SubmitResult[];
};

export type SubmitResult = {
  time: number;
  inputs: Verdict[];
  score: number;
  startcombo: number;
  timeAdd: number;
};
export type Verdict = { v: number; state: "ok" | "ng" | "skip" };

export type Stats = {
  score: number;
  solved: number;
  perfect: number;
  submits: number; // 提出回数
  misses: number;
  maxCombo: number;

  inputs: number; // Submitされた素因数の数
  corrects: number; // 正しい素因数の数
  wrongs: number; // 不正解の素因数の数
  skips: number; // 不正解によって判定されなかった素因数の数

  extendedTime: number; // 延長された時間の合計
  maxChunk: number; // 一度の提出の素因数数の最大
  maxPrime: number; // 正しい回答に含まれる最大の素因数
  maxDifficulty: { no: number; d: number }; // 解き切った最大の難易度
  maxPoints: { no: number; pts: number }; // 解き切った問題の最大得点
};

export type Result = {
  sessionId: string;
  rulesetId: string;
  rulesetVersion: number;
  mode: Mode;
  customRuleset?: RuleSet;
  seed: number;
  recs: Rec[];
  stats: Stats;
  playerId: number | null | undefined;
  playedAt: number;
  playTime: number;
};

export function calcStats(recs: Rec[]): Stats {
  const s: Stats = {
    score: 0,
    solved: 0,
    perfect: 0,
    submits: 0,
    misses: 0,
    maxCombo: 0,
    inputs: 0,
    corrects: 0,
    wrongs: 0,
    skips: 0,
    extendedTime: 0,
    maxChunk: 0,
    maxPrime: 0,
    maxDifficulty: { no: 0, d: 0 },
    maxPoints: { no: 0, pts: 0 }
  };
  for (const r of recs) {
    s.score += r.pts;
    s.misses += r.miss;
    s.submits += r.submits.length;
    if (r.done) {
      s.solved++;
      if (r.perfect) s.perfect++;
      if (r.d > s.maxDifficulty.d) s.maxDifficulty = { no: r.no, d: r.d };
      if (r.pts > s.maxPoints.pts) s.maxPoints = { no: r.no, pts: r.pts };
      s.maxPrime = Math.max(s.maxPrime, ...r.factors);
    }
    for (const sub of r.submits) {
      s.extendedTime += sub.timeAdd;
      s.inputs += sub.inputs.length;
      s.maxChunk = Math.max(s.maxChunk, sub.inputs.length);
      let combo = sub.startcombo; // 誤りで0に戻る仮定
      for (const v of sub.inputs) {
        if (v.state === "ok") {
          s.corrects++;
          s.maxCombo = Math.max(s.maxCombo, ++combo);
        } else if (v.state === "ng") {
          s.wrongs++;
          combo = 0;
        } else s.skips++;
      }
    }
  }
  return s;
}

export function buildResult(base: Omit<Result, "recs" | "stats">, recs: Rec[]): Result {
  const copy = recs.slice();
  return { ...base, recs: copy, stats: calcStats(copy) };
}
