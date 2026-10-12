// ===== src/shared/generator.ts =====
// 生成は四則演算・比較のみ（pow/log 非使用）。DOM/Date/Math.random 非依存でサーバーでも動作
import type { RuleSet, Rules, Mode, ShapeId, PrimeEntry } from "./rules";

export interface Problem {
  target: number;
  factors: number[];
  d: number;
  shape: ShapeId;
  level: number;
}

export interface ProblemState {
  p: Problem;
  miss: number;
  chunks: number;
  remaining: number[]; // 未確定の素因数
  queue: Map<number, number[]>; // 素数ごとの未配分の寄与値（parts の occ）
  totW: number;
  total: number;
  P: number;
  recs: { pts: number; m: number }[]; // チャンクごとの得点と倍率（時間バフの再計算用）
  acc: number; // 時間バフ前の累積
  done: boolean;
}
export interface ChunkResult {
  accepted: number; // 受理された素因数の数（先頭から連続して正しい分）
  gain: number; // 今回の加点（整数）
  live: number; // 問題内の累積（整数）
  perfect: boolean;
  done: boolean;
  missed: boolean; // 誤りで停止した
  miss: number; // この問題の Miss 数
  missMult: number; // 現在の Miss 倍率（表示用）
  factors: { v: number; gain: number; combo: number }[];
}
export type Step = { type: "miss" } | { type: "chunk"; factors: number[]; combo?: number };

export const debug = { on: true };
let rows: object[] = [];
const dlog = (...a: unknown[]) => {
  if (debug.on) console.log(...a);
};
const dtable = (rows: object[]) => {
  if (debug.on) console.table(rows);
};

export function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const countOf = (a: number[]) => {
  const m = new Map<number, number>();
  for (const x of a) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

function factorize(n: number): number[] {
  const fs: number[] = [];
  for (let d = 2; d * d <= n; d++)
    while (n % d === 0) {
      fs.push(d);
      n /= d;
    }
  if (n > 1) fs.push(n);
  return fs;
}

export function createEngine(rs: RuleSet, mode: Mode) {
  const PRIME = new Map(rs.rules.primes.map((e) => [e.p, e]));
  const POOL = rs.rules.primes.map((e) => e.p);
  const KNOWN = (() => {
    const seen = new Set<number>();
    const out: { q: number; cnt: Map<number, number>; mult: number }[] = [];
    for (const g of rs.rules.difficulty.known) {
      for (const q of g.products) {
        if (seen.has(q)) continue;
        const fs = factorize(q);
        if (!fs.every((p) => PRIME.has(p))) continue; // 未登録の素数を含む数は無視
        seen.add(q);
        out.push({ q, cnt: countOf(fs), mult: g.mult });
      }
    }
    return out.sort((a, b) => b.q - a.q); // 大きい積から照合
  })();

  // 10の倍数(2×5ペア)を除外し昇順で返す
  function reduce10(fs: number[]): { rf: number[]; m10: number } {
    const m = Math.min(fs.filter((p) => p === 2).length, fs.filter((p) => p === 5).length);
    let r2 = m,
      r5 = m;
    const rf: number[] = [];
    for (const p of fs) {
      if (p === 2 && r2 > 0) {
        r2--;
        continue;
      }

      if (p === 5 && r5 > 0) {
        r5--;
        continue;
      }
      rf.push(p);
    }
    return { rf: rf.sort((a, b) => a - b), m10: m };
  }

  const repC = (p: number, k: number) => {
    const [n, s1, s2] = PRIME.get(p)!.rep;
    return 1 + s1 * Math.min(k - 1, n - 1) + s2 * Math.max(0, k - n + 1);
  };

  // 末尾(昇順)の形による倍率。除外前の rf で判定
  function tailMult(rf: number[]): number {
    const n = rf.length;
    for (const r of rs.rules.difficulty.tail) {
      if (r.kind === "same3" && n >= 3 && rf[n - 1] === rf[n - 2] && rf[n - 2] === rf[n - 3]) return r.mult;
      if (r.kind === "same2" && n >= 2 && rf[n - 1] === rf[n - 2]) return r.mult;
      if (r.kind === "adj2" && n >= 2 && rf[n - 1] !== rf[n - 2] && POOL.indexOf(rf[n - 1]) - POOL.indexOf(rf[n - 2]) === 1) return r.mult;
    }
    return 1;
  }

  // 難易度の内訳。occ は素因数ごとの寄与(スコア配分用)。
  function parts(fs: number[]): { raw: number; mult: number; occ: [number, number][] } {
    const R = rs.rules.difficulty;
    const { rf, m10 } = reduce10(fs);
    const hasLast = R.excludeLast.enabled && rf.length > 0;
    const core = hasLast ? rf.slice(0, -1) : rf;
    const cnt = countOf(core);

    const occ: [number, number][] = [];
    let raw = 0;
    for (const p of [...cnt.keys()].sort((a, b) => a - b)) {
      const e = PRIME.get(p)!;
      for (let k = 1; k <= cnt.get(p)!; k++) {
        const v = e.base * repC(p, k) + (k === 1 ? e.kind : 0);
        occ.push([p, v]);
        raw += v;
      }
    }
    const X = R.excludeLast.scoreMult;
    if (hasLast) occ.push([rf[rf.length - 1], PRIME.get(rf[rf.length - 1])!.base * X]);
    for (let i = 0; i < m10; i++) occ.push([2, PRIME.get(2)!.base * X], [5, PRIME.get(5)!.base * X]);
    if (core.length === 0) return { raw: 0, mult: 1, occ };

    // 既知の積: 該当素因数の base 分を (1-mult) だけ減算
    const avail = countOf(rf);
    const coreLeft = new Map(cnt);
    let disc = 0;
    for (const k of KNOWN) {
      if ([...k.cnt].every(([p, m]) => (avail.get(p) ?? 0) >= m)) {
        for (const [p, m] of k.cnt) {
          const inCore = Math.min(m, coreLeft.get(p) ?? 0);
          disc += (1 - k.mult) * PRIME.get(p)!.base * m;
          avail.set(p, avail.get(p)! - m);
          coreLeft.set(p, (coreLeft.get(p) ?? 0) - inCore);
        }
      }
    }
    raw = Math.max(1, raw - disc);

    let mult = 1 + R.count.perExtra * (core.length - 1);
    let nb = 0,
      kb = 0;
    for (const [p, m] of cnt)
      if (p >= R.big.from) {
        nb += m;
        kb++;
      }
    mult *= 1 + Math.min(R.big.cap, R.big.perCount * Math.max(0, nb - 1) + R.big.perKind * Math.max(0, kb - 1));

    const digits = String((R.excludeLast.digitFull ? rf : core).reduce((a, b) => a * b, 1)).length;
    mult *= 1 + R.digit.perDigit * Math.max(0, digits - R.digit.from + 1);
    mult *= tailMult(rf);
    return { raw, mult, occ };
  }

  function calcD(fs: number[]): number {
    const { raw, mult } = parts(fs);
    return raw * mult;
  }

  function levelOf(n: number, sd: number): number {
    const L = rs.rules.level[mode];
    return Math.min(L.cap, L.L0 + L.perN * n + L.perSD * sd);
  }

  function pickShape(rng: () => number, level: number): ShapeId {
    const c = (Object.entries(rs.rules.gen.shapes) as [ShapeId, (typeof rs.rules.gen.shapes)[ShapeId]][]).filter(([, v]) => level >= v.minLevel);
    let r = rng() * c.reduce((s, [, v]) => s + v.w, 0);
    for (const [k, v] of c) {
      r -= v.w;
      if (r < 0) return k;
    }
    return c[c.length - 1][0];
  }

  // 解放後に weight が 0→規定値へ増加する係数
  function rampFactor(p: number, level: number): number {
    const e = PRIME.get(p)!;
    const len = e.ramp.length;
    if (len <= 0) return 1;
    let t = Math.min(1, Math.max(0, (level - e.unlock) / len));
    if (e.ramp.curve === "smooth") t = t * t * (3 - 2 * t);
    else if (e.ramp.curve === "quad") t = t * t;
    const f = rs.rules.gen.ramp.floor;
    return f + (1 - f) * t;
  }

  function pickWeight(p: number, fs: number[], sp: { smallMult: number; bigMult: number }, recent: readonly number[], level: number): number {
    const G = rs.rules.gen;
    let w = PRIME.get(p)!.pick * (p < rs.rules.difficulty.big.from ? sp.smallMult : sp.bigMult);
    w *= rampFactor(p, level);
    let cnt = 0;
    for (const x of recent) if (x === p) cnt++;
    for (let i = 0; i < cnt; i++) w *= G.recent.mult;
    for (const pp of G.pairPick) {
      if ((p === pp.a && fs.includes(pp.b)) || (p === pp.b && fs.includes(pp.a))) w *= pp.mult;
    }
    return w;
  }

  // 乱数は seed と index のみに依存。recent は直前までの素因数履歴(pushRecent で更新)
  function generate(seed: number, index: number, level: number, recent: readonly number[] = [], avoid: readonly number[] = []): Problem {
    const G = rs.rules.gen;
    const rng = mulberry32(hash32(seed, index));
    const shape = pickShape(rng, level);
    const sp = G.shapes[shape];
    const lo = level * (1 - G.rD),
      hi = level * (1 + G.rD);
    let usable = POOL.filter((p) => PRIME.get(p)!.unlock <= level && p >= sp.floor);
    if (usable.length === 0) usable = [2];

    let best: Problem | null = null;
    let dupBest: Problem | null = null;
    for (let attempt = 0; attempt < G.maxRetry; attempt++) {
      const fs: number[] = [];
      let target = 1,
        D = 0;
      while (fs.length < G.maxFactors && (fs.length < G.minFactors || D < lo)) {
        const cand: [number, number][] = [];
        for (const p of usable) {
          if (target * p > G.maxTarget) continue;
          const chk = fs.length + 1 < G.minFactors ? [...fs, p, usable[0]] : [...fs, p];
          if (calcD(chk) > hi) continue;
          cand.push([p, pickWeight(p, fs, sp, recent, level)]);
        }
        if (cand.length === 0) break;
        let r = rng() * cand.reduce((s, c) => s + c[1], 0);
        let pick = cand[cand.length - 1][0];
        for (const [p, w] of cand) {
          r -= w;
          if (r < 0) {
            pick = p;
            break;
          }
        }
        fs.push(pick);
        target *= pick;
        D = calcD(fs);
      }
      if (fs.length < G.minFactors) continue;
      const cur: Problem = { target, factors: [...fs].sort((a, b) => a - b), d: D, shape, level };
      const dup = avoid.includes(target);
      if (!dup && D >= lo && D <= hi) return cur;
      const ref = dup ? dupBest : best;
      if (!ref || Math.abs(D - level) < Math.abs(ref.d - level)) {
        if (dup) dupBest = cur;
        else best = cur;
      }
    }
    return best ?? dupBest ?? { target: 4, factors: [2, 2], d: calcD([2, 2]), shape, level };
  }

  const pushRecent = (recent: readonly number[], factors: readonly number[]): number[] => [...recent, ...factors].slice(-rs.rules.gen.recent.window * 4);

  function startProblem(p: Problem): ProblemState {
    const { raw, mult, occ } = parts(p.factors);
    const queue = new Map<number, number[]>();
    for (const [pr, v] of occ) {
      if (!queue.has(pr)) queue.set(pr, []);
      queue.get(pr)!.push(v);
    }
    const S = rs.rules.score;
    const totW = occ.reduce((s, [, v]) => s + v, 0) || 1e-9;
    const total = baseScore(p.d);
    const P = Math.min(S.perfect.maxMult - 1, S.perfect.a * Math.pow(p.d, S.perfect.gamma));
    if (debug.on) {
      dlog(`[start] target=${p.target} f=[${p.factors}] D=${p.d.toFixed(1)} raw=${raw.toFixed(2)} mult=${mult.toFixed(3)} lv=${p.level.toFixed(1)} shape=${p.shape}`);
      dlog(`[start] total=${total.toFixed(1)} P=${P.toFixed(3)} totW=${totW.toFixed(2)}`);
      rows = [];
      // dtable(occ.map(([pr, v]) => ({ p: pr, contrib: +v.toFixed(2), share: +(v / totW).toFixed(4) })));
    }
    return { p, miss: 0, chunks: 0, remaining: [...p.factors], queue, totW, total, P, recs: [], acc: 0, done: false };
  }

  function missMult(miss: number): number {
    const ms = rs.rules.score.miss;
    let m = 1;
    if (ms.mode === "geom") for (let i = 0; i < miss; i++) m *= 1 - ms.n;
    else m = 1 - ms.n * miss;
    return Math.max(ms.floor, m);
  }

  // 仮決定: 先頭から検査し、正しい分だけ加点して、誤りの位置で Miss を登録して停止する
  function submitChunk(st: ProblemState, chunk: number[], combo: number): ChunkResult {
    const S = rs.rules.score,
      cb = S.combo[mode];
    const rem = [...st.remaining];
    const acc: number[] = [];
    let bad = false;
    for (const x of chunk) {
      if (bad) break;
      const i = rem.indexOf(x);
      if (i < 0) {
        bad = true;
        break;
      }
      rem.splice(i, 1);
      acc.push(x);
    }

    let gain = 0,
      perfect = false;
    const per: ChunkResult["factors"] = [];
    if (acc.length > 0) {
      const fs = acc.map((pr) => st.queue.get(pr)!.shift()! / st.totW); // 素因数ごとの寄与比
      const f = fs.reduce((a, b) => a + b, 0);
      perfect = st.chunks === 0 && rem.length === 0 && st.miss === 0;
      const ratio = perfect ? 1 : S.chain.by === "weight" ? S.chain.max * f : Math.min(S.chain.max, S.chain.step * (acc.length - 1));
      const m = Math.min(S.totalMultCap, 1 + st.P * ratio);
      const mm = missMult(st.miss); // 今回の誤りより前の Miss のみ反映
      const start = st.acc;
      let run = start;
      for (let i = 0; i < fs.length; i++) {
        const cm = cb.kind === "mult" ? Math.min(cb.max, 1 + cb.add * Math.floor((combo + i) / cb.every)) : 1;
        const p = st.total * fs[i] * m * mm * cm;
        per.push({ v: acc[i], gain: Math.floor(run + p) - Math.floor(run), combo: combo + i + 1 });
        rows.push({ p: acc[i], share: +fs[i].toFixed(4), chain: +m.toFixed(3), miss: +mm.toFixed(3), combo: combo + i, cm: +cm.toFixed(3), pts: +(st.total * fs[i] * m * mm * cm).toFixed(2) });
        run += p;
      }
      st.acc = run;
      st.recs.push({ pts: run - start, m });
      st.remaining = rem;
      st.chunks++;
      st.done = rem.length === 0;
      gain = Math.floor(run) - Math.floor(start);
    }
    if (bad) st.miss++; // 加点の後に Miss を登録
    if (bad) dlog(`[submit] MISS in=[${chunk}] rejected=${chunk[acc.length]} miss=${st.miss} missMult=${missMult(st.miss).toFixed(3)}`);

    // dlog(`[submit] in=[${chunk}] ok=${acc.length} perfect=${perfect} f=${f.toFixed(3)} ratio=${ratio.toFixed(3)} P=${st.P.toFixed(3)} m=${m.toFixed(3)} total=${st.total.toFixed(1)} gain=${gain} acc=${st.acc.toFixed(1)}`);

    return { accepted: acc.length, gain, live: Math.floor(st.acc), perfect, done: st.done, missed: bad, miss: st.miss, missMult: missMult(st.miss), factors: per };
  }

  // 完了時に1回。時間バフを加算（合計倍率の上限を守る）。t は解答時間(秒)
  function finishProblem(st: ProblemState, t?: number): { bonus: number; total: number } {
    const S = rs.rules.score;
    let tb = 1;
    if (t !== undefined && st.p.d >= S.timeBuff.fromD) {
      const texp = S.timeBuff.texp.a * Math.pow(st.p.d, S.timeBuff.texp.gamma);
      for (const tier of [...S.timeBuff.tiers].sort((a, b) => a.ratio - b.ratio)) {
        if (t / texp <= tier.ratio) {
          tb = tier.mult;
          break;
        }
      }
    }
    let bonus = 0;
    for (const r of st.recs) bonus += r.pts * (Math.min(tb, S.totalMultCap / r.m) - 1);
    const before = Math.floor(st.acc);
    const total = Math.floor(st.acc + bonus);

    dtable(rows);
    if (debug.on) dlog(`[finish] total=${total.toFixed(1)} bonus=${bonus.toFixed(1)} acc=${st.acc.toFixed(1)} tb=${tb.toFixed(3)}`);

    return { bonus: total - before, total };
  }

  const baseCurve = (() => {
    const b = rs.rules.score.base;
    if (b.kind === "table") return { a: 0, k: 0 };
    else if (b.kind === "anchor") {
      const k = Math.log(b.s2 / b.s1) / Math.log(b.d2 / b.d1);
      return { a: b.s1 / Math.pow(b.d1, k), k };
    } else {
      return { a: b.a, k: b.k };
    }
  })();

  function baseScore(d: number): number {
    const b = rs.rules.score.base;
    if (b.kind === "table" && b.table && b.table.length > 0) {
      const t = b.table;
      const x = Math.min(t.length - 1, Math.max(0, d));
      const i = Math.floor(x);
      return i >= t.length - 1 ? t[t.length - 1] : t[i] + (t[i + 1] - t[i]) * (x - i);
    }
    return baseCurve.a * Math.pow(Math.max(0, d), baseCurve.k);
  }

  return { calcD, parts, levelOf, generate, pushRecent, startProblem, submitChunk, finishProblem, problemBase: baseScore };
}

export type Engine = ReturnType<typeof createEngine>;

// 同じ ruleset オブジェクトは再構築しない
const cache = new WeakMap<RuleSet, Engine>();
export function getEngine(rs: RuleSet, mode: Mode): Engine {
  let e = cache.get(rs);
  if (!e) {
    e = createEngine(rs, mode);
    cache.set(rs, e);
  }
  return e;
}
