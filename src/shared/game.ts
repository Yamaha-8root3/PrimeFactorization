import { getEngine, type Engine } from "./gameengine";
import type { GameSetup, Config, RuleSet } from "./rules";
import type { ChunkResult, Problem, ProblemState } from "./gameengine";
import type { Mode } from "./rules";

export interface SubmitResult extends ChunkResult {
  combo: number;
  timeAdd: number;
}

export class Game {
  readonly seed: number;
  readonly mode: Mode;
  readonly config: Config;
  readonly ruleset: RuleSet;
  private e: Engine;
  private index = 0;
  private sd = 0; // これまでの合計難易度
  private recent: number[] = [];
  private recentTargets: number[] = [];
  private combo = 0;
  private extraSec = 0; // 付与済みの延長時間の合計
  get totalLimitSec() {
    return this.timeLimitSec + this.extraSec;
  }
  usePrimes: number[];

  constructor(setup: GameSetup) {
    this.seed = setup.seed;
    this.config = setup.config;
    this.mode = setup.mode;
    this.ruleset = setup.ruleset;
    this.e = getEngine(setup.ruleset, setup.mode);
    this.usePrimes = this.ruleset.rules.primes.map((p) => p.p);
  }

  get timeLimitSec(): number {
    return this.ruleset.rules.time[this.mode].limitSec;
  }

  get comboNow() {
    return this.combo;
  }

  // 問題の完了時に1回。時間バフを加算
  finish(st: ProblemState, t?: number): { bonus: number; total: number } {
    return this.e.finishProblem(st, t);
  }

  // 次の問題を生成して状態を進める
  next(): ProblemState {
    const level = this.e.levelOf(this.index, this.sd);
    const p = this.e.generate(this.seed, this.index, level, this.recent, this.recentTargets);
    const ps = this.e.startProblem(p);
    this.index++;
    this.sd += p.d;
    this.recent = this.e.pushRecent(this.recent, p.factors);
    let t = p.target;
    //
    while (t % 10 === 0) t /= 10;
    this.recentTargets = [...this.recentTargets, t].slice(-this.ruleset.rules.gen.avoid.window);
    return ps;
  }

  // 仮決定の提出。誤りの検証と Miss の登録、コンボ更新、延長時間の付与まで行う
  submit(st: ProblemState, chunk: number[]): SubmitResult {
    const r = this.e.submitChunk(st, chunk, this.combo);
    const old = this.combo;
    this.combo += r.accepted; // 1素因数ごとに +1
    const timeAdd = this.grantTime(old, this.combo); // 誤りでのリセット前に判定
    if (r.missed) this.combo = this.applyMiss(this.combo);
    return { ...r, combo: this.combo, timeAdd };
  }

  private grantTime(from: number, to: number): number {
    const cb = this.ruleset.rules.score.combo[this.mode];
    if (cb.kind !== "time") return 0;
    const cross = Math.floor(to / cb.every) - Math.floor(from / cb.every); // 閾値を跨いだ回数
    const add = Math.max(0, Math.min(cross * cb.add, cb.max - this.extraSec));
    this.extraSec += add;
    return add;
  }

  private applyMiss(c: number): number {
    const m = this.ruleset.rules.score.combo[this.mode].onMiss;
    return m === "zero" ? 0 : m === "half" ? Math.floor(c / 2) : c;
  }

  // サーバー検証用: 提出ログを先頭から再生。log[i] は問題 i の提出列と解答時間
  static replayLog(setup: GameSetup, log: { submits: number[][]; t?: number }[]) {
    const g = new Game(setup);
    let score = 0,
      ok = true;
    for (let i = 0; i < log.length; i++) {
      const st = g.next();
      for (const s of log[i].submits) score += g.submit(st, s).gain;
      if (st.done) score += g.finish(st, log[i].t).bonus;
      else if (i !== log.length - 1) ok = false; // 途中終了は最後の問題のみ許容
    }
    return { score, ok, extraSec: g.extraSec };
  }
}
