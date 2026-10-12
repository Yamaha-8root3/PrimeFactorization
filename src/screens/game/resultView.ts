import { Rec, Result } from "./result";

const fmt = (x: number) => x.toLocaleString("en-US"); // 既存の整形関数があれば差し替え
const per = (a: number, b: number) => (b > 0 ? a / b : 0);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const tile = (k: string, v: string, sub = "") => `<div class="rt"><b>${k}</b><span>${v}</span>${sub ? `<i>${sub}</i>` : ""}</div>`;

// prevBest: 保存済みハイスコア（なければ null）
export function renderStats(el: HTMLElement, res: Result, prevBest: number | null) {
  const { stats: s, recs } = res;
  const totalMs = recs.reduce((a, r) => a + r.ms, 0);
  const sec = totalMs / 1000;
  const isNew = prevBest === null || s.score > prevBest;
  const diff = prevBest === null ? null : s.score - prevBest;

  const q = (no: number) => recs.find((r) => r.no === no);
  const primeRec = s.maxPrime ? recs.find((r) => r.done && r.factors.includes(s.maxPrime)) : undefined;
  const chunkRec = s.maxChunk ? recs.find((r) => r.submits.some((x) => x.inputs.length === s.maxChunk)) : undefined;
  const ref = (r?: Rec) => (r ? `Q${r.no} · ${fmt(r.n)}` : "-");

  const submitsAtFinishedProblem = recs.reduce((a, r) => a + (r.done ? r.submits.length : 0), 0);

  const w = (x: number) => `style="width:${pct(x, s.inputs)}%"`;

  el.innerHTML = `
  <div class="rs-head">
    <div class="rs-score">${fmt(s.score)}</div>
    <div class="rs-prev">
      ${isNew ? '<span class="rs-new">NEW RECORD</span>' : ""}
      <span>HI-Score: ${prevBest === null ? "-" : fmt(prevBest)}</span>
      <span>(${diff === null ? "" : (diff >= 0 ? "+" : "") + fmt(diff)})</span>
    </div>
  </div>
  <div class="rs-tiles">
    ${tile("SOLVED", fmt(s.solved))}
    ${tile("PERFECT", fmt(s.perfect), `${pct(s.perfect, s.solved).toFixed(0)}%`)}
    ${tile("MISS", fmt(s.misses))}
    ${tile("MAX COMBO", fmt(s.maxCombo))}
  </div>
  <div class="rs-acc">
    <div class="rs-bar">
      <u class="ok" ${w(s.corrects)}></u><u class="ng" ${w(s.wrongs)}></u><u class="sk" ${w(s.skips)}></u>
    </div>
    <div class="rs-accrow">
      <span>Acc ${pct(s.corrects, s.inputs).toFixed(1)}%</span>
      <span>OK ${s.corrects} / Wrong ${s.wrongs} / Skip ${s.skips}</span>
    </div>
    <div class="rs-accrow">
      <span>Input ${s.inputs} (${per(s.inputs, sec).toFixed(2)}/s)</span>
      <span>Submit ${s.submits} (${per(s.submits, sec).toFixed(2)}/s)</span>
    </div>
    <div class="rs-accrow">
      <span>SolvedSubmit ${submitsAtFinishedProblem} (${per(submitsAtFinishedProblem, s.solved).toFixed(2)}/problem)</span>
    </div>
  </div>
  <div class="rs-tiles">
    ${tile("MAX DIFF", fmt(s.maxDifficulty.d), ref(q(s.maxDifficulty.no)))}
    ${tile("MAX POINTS", fmt(s.maxPoints.pts), ref(q(s.maxPoints.no)))}
    ${tile("MAX PRIME", s.maxPrime ? fmt(s.maxPrime) : "-", ref(primeRec))}
    ${tile("MAX CHUNK", fmt(s.maxChunk), ref(chunkRec))}
  </div>
  <div class="rs-tiles">
    ${tile("ANSWER TIME", sec.toFixed(1) + "s")}
    ${tile("EXTENDED", "+" + s.extendedTime + "s")}
  </div>`;
}
