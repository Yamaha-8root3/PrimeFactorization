import "./game.css";
import { generate, prod, progressOf, stageOf, PRIME_POOL, type Stage } from "./generator";
import { factorPoints, factorBase } from "./score";
import { loadBest, saveBest } from "../../shared/storage";
import { $, press } from "../../shared/dom";

press($("btn-divide"), divide);
press($("btn-undo"), undo);
press($("btn-clear"), clearInput);
press($("btn-restart"), beginCountdown);
press($("btn-title"), toTitle);

const el = {
  target: $("target"),
  originaltarget: $("originaltarget"),
  answer: $("answer"),
  expoInput: $("expo-input"),
  expoAll: $("expo-all"),
  err: $("err"),
  timer: $("timer"),
  score: $("score"),
  history: $("history"),
  diff: $("diff"),
  range: $("range"),
  gain: $("gain"),
  maxp: $("maxp"),
  stSolved: $("st-solved"),
  stMiss: $("st-miss"),
  stAvg: $("st-avg"),
  stBest: $("st-best"),
  trial: $("trial"),
  qno: $("qno")
};

//素数ボタン用意
const KEYMAP: Record<string, number> = {
  q: 2,
  w: 3,
  e: 5,
  r: 7,
  t: 11,
  y: 13,
  u: 17,
  i: 19,
  a: 23,
  s: 29,
  d: 31,
  f: 37,
  g: 41,
  h: 43,
  j: 47,
  k: 53
};

const keyOf = (p: number) =>
  Object.keys(KEYMAP)
    .find((k) => KEYMAP[k] === p)
    ?.toUpperCase() ?? "";
$("prime-buttons").innerHTML = PRIME_POOL.map((p) => `<button class="prime-btn" data-prime="${p}"><span class="num">${p}</span><kbd>${keyOf(p)}</kbd></button>`).join("");

const isUnlocked = (p: number) => p <= stageOf(progress).maxPrime;
document.querySelectorAll<HTMLElement>(".prime-btn").forEach((b) =>
  press(b, () => {
    const p = Number(b.dataset.prime);
    if (isUnlocked(p)) addPrime(p);
  })
);

//変数
type Phase = "idle" | "count" | "play" | "result"; // idle = ゲーム画面が非表示（タイトル中）
let phase: Phase = "idle";
let resultAt = 0;
let onExit: () => void = () => {};
const COUNT_STEP = 800;

type Rec = {
  no: number;
  n: number;
  factors: number[];
  d: number;
  ms: number;
  miss: number;
  perfect: boolean;
  base: number; // 基礎点（コンボ・PERFECT 倍率を掛ける前の合計）
  pts: number; // 実際に得た得点
  done: boolean; // false = 時間切れで未完了
};

const solveLog: { n: number; d: number; ms: number; miss: number }[] = [];
type Verdict = { v: number; state: "ok" | "ng" | "skip" };

const TIME_LIMIT = 100_000; // ms
const playing = () => phase === "play";
let gameStart = 0;
let gameId = 0;
const later = (ms: number, fn: () => void) => {
  const id = gameId;
  setTimeout(() => {
    if (id === gameId) fn();
  }, ms);
};
let bestScore = loadBest();

let target = 0;
let curFactors: number[] = []; // 今の問題の正解（素因数分解）
let entered: number[] = [];
let committed = 0; // 仮決定済みの入力数

let qno = 0;
let combo = 0;
let comboShown = 0;
let maxCombo = 0;
let probBase = 0; // この問題の基礎点の合計
let decides = 0; // この問題での決定回数
let probPts = 0; // この問題で得た点
let score = 0;
let miss = 0;
let progress = 0;

let startedAt = 0;
const history: Rec[] = [];
let curDiff = 0;
let curStage: Stage = stageOf(0);
let AUTO_FINISH = false; // 一時停止中。true で従来の「積が一致したら自動回答」に戻る
const STEP = 50; // ms。判定済みの項目を順に消す演出の間隔
const T = { ok: 100, ng: 300, skip: 200 }; // ms
let trialSeq = 0;
let queueEndAt = 0; // 演出キューが終わる時刻
const GAIN_HOLD = 1200; // 最後の加算からこの時間(ms)で消える
let gainAcc = 0;
let gainTimer = 0;

//score
// スコア表示のイージング（easeOutCubic）。加算のたびに現在の表示値から目標へ張り直す
const TWEEN_MS = 600;
let scoreShown = 0,
  scoreFrom = 0,
  scoreTo = 0,
  tweenStart = 0,
  raf = 0;

//キーボード入力
const BUF_MAX = 6;
let buf = "";

//素因数分解の整形テキスト生成
function expo(list: number[], html: boolean): string {
  const m = new Map<number, number>();
  [...list].sort((a, b) => a - b).forEach((p) => m.set(p, (m.get(p) ?? 0) + 1));
  return [...m].map(([p, c]) => (c === 1 ? `${p}` : html ? `${p}<sup>${c}</sup>` : `${p}^${c}`)).join("×");
}

function nextProblem() {
  const pb = generate(progress);
  curFactors = [...pb.factors].sort((a, b) => a - b);
  probBase = curFactors.reduce((s, p) => s + factorBase(p), 0);
  qno++;
  target = pb.n;
  curStage = pb.stage;
  curDiff = pb.d;
  entered = [];
  buf = "";
  decides = 0;
  probPts = 0;
  committed = 0;
  startedAt = performance.now();
  render();
}

function render() {
  el.qno.textContent = `Q${qno}`;
  el.target.textContent = String(target / prod(entered.slice(0, committed)));
  el.originaltarget.textContent = String(target);
  // 回答欄は未確定分のみ
  el.answer.innerHTML = entered
    .slice(committed)
    .map((p) => `<span class="chip">${p}</span>`)
    .join("");
  // 確定分＋未確定分の整形済み表示
  const pending = entered.slice(committed);
  const bad = buf !== "" && !PRIME_POOL.includes(Number(buf));
  const typing = buf ? `<span class="chip typing${bad ? " bad" : ""}">${buf}</span>` : "";
  el.answer.innerHTML = `<span class="ltr">${pending.map((p) => `<span class="chip">${p}</span>`).join("")}${typing}</span>`;
  el.expoInput.innerHTML = `<span class="ltr">${expo(pending, true)}</span>`;
  el.expoAll.innerHTML = `<span class="ltr">${expo(entered, true)}</span>`;
  el.err.hidden = true;
  el.score.textContent = score.toLocaleString();

  const row = (r: Rec) =>
    `<li><span class="h-no">${r.no}</span><span class="h-n">${r.n}</span>` + `<span class="h-d">${r.d.toFixed(2)}</span><span class="h-s">${r.perfect ? "★" : ""}</span>` + `<span class="h-p">+${r.pts.toLocaleString()}</span><span class="h-t">${(r.ms / 1000).toFixed(1)}s</span></li>`;
  // 最上段: 解いている途中の問題と途中得点
  const curRow = playing() ? `<li class="cur"><span class="h-no">${qno}</span><span class="h-n">${target}</span>` + `<span class="h-d">${curDiff.toFixed(2)}</span><span class="h-s"></span>` + `<span class="h-p">+${probPts.toLocaleString()}</span><span class="h-t">…</span></li>` : "";

  el.history.innerHTML = curRow + history.map(row).join("");

  el.diff.textContent = curDiff.toFixed(2);
  el.range.textContent = `${curStage.dMin.toFixed(1)} – ${curStage.dMax.toFixed(1)}`;

  const st = summarize(history);
  el.stSolved.textContent = String(st.solved);
  el.stMiss.textContent = String(st.misses + miss); // 現在の問題の誤りも含む
  el.stAvg.textContent = st.solved ? `${(st.avgMs / 1000).toFixed(1)}s` : "-";
  el.stBest.textContent = Math.max(bestScore, score).toLocaleString();
  el.maxp.textContent = `≤ ${curStage.maxPrime}`;
  document.querySelectorAll<HTMLButtonElement>(".prime-btn").forEach((b) => {
    b.disabled = Number(b.dataset.prime) > curStage.maxPrime;
  });
}

function typeDigit(d: string) {
  if (buf === "" && d === "0") return; // 先頭の 0 は無視（0 による除算を防ぐ）
  if (buf.length >= BUF_MAX) return;
  buf += d;
  render();
}
function backBuf() {
  buf = buf.slice(0, -1);
  render();
}
function commitBuf() {
  if (!buf) return;
  const v = Number(buf);
  buf = "";
  if (!PRIME_POOL.includes(v)) {
    render();
    return;
  } else {
    addPrime(v);
  }
}

function addPrime(p: number) {
  if (!playing()) return;
  entered.push(p);
  if (AUTO_FINISH && prod(entered) === target) finish(false);
  else render();
}

function clearInput() {
  if (!playing()) return;
  entered.length = committed;
  buf = "";
  render();
}

function undo() {
  if (!playing()) return;
  if (entered.length > committed) {
    entered.pop();
    render();
  }
}

function divide() {
  if (!playing()) return;
  commitBuf();
  const pending = entered.slice(committed);
  if (!pending.length) return;

  let rem = target / prod(entered.slice(0, committed));
  const verdicts: Verdict[] = [];
  let stopped = false;
  for (const p of pending) {
    if (stopped) {
      verdicts.push({ v: p, state: "skip" });
      continue;
    }
    const ok = rem % p === 0;
    verdicts.push({ v: p, state: ok ? "ok" : "ng" });
    if (ok) rem /= p;
    else stopped = true;
  }
  const okCount = verdicts.filter((x) => x.state === "ok").length;
  const perfect = decides === 0 && !stopped && rem === 1;
  decides++;

  const ds = playTrial(verdicts);
  let gained = 0;
  verdicts.forEach((x, i) => {
    if (x.state === "ok") {
      combo++;
      const pts = factorPoints(x.v, combo, perfect);
      gained += pts;
      const c = combo,
        run = score + gained; // この時点までの累計
      later(ds[i], () => {
        addGain(pts, perfect);
        setScoreTarget(run);
        showCombo(c);
      });
    } else if (x.state === "ng") {
      later(ds[i], breakCombo);
    }
  });
  maxCombo = Math.max(maxCombo, combo);
  if (stopped) {
    miss++;
    combo = 0;
  }
  score += gained;
  probPts += gained;
  if (perfect) showBanner("perfect");

  entered.length = committed + okCount;
  committed = entered.length;
  if (rem === 1) finish(perfect);
  else render();
}

// 判定済みの項目から順に消す演出。未判定の項目は表示したまま残る
// 実行中のキューがあれば、その後ろに追加して順番に再生する
function playTrial(vs: Verdict[]) {
  const box = $("trial");
  const now = performance.now();
  const base = Math.max(0, queueEndAt - now);
  const okCount = vs.filter((x) => x.state === "ok").length;
  let end = 0;
  const ds = vs.map((x, i) => {
    const d = base + (x.state === "skip" ? okCount + 1 : i) * STEP;
    end = Math.max(end, d + T[x.state]);
    return d;
  });
  box.insertAdjacentHTML("beforeend", vs.map((x, i) => `<span class="chip ${x.state}" style="--d:${ds[i]}ms;--t:${T[x.state]}ms">${x.v}</span>`).join(""));
  queueEndAt = now + end;
  const my = ++trialSeq;
  setTimeout(() => {
    if (my === trialSeq) box.replaceChildren();
  }, end + 50);
  return ds;
}

function finish(perfect: boolean) {
  const ms = Math.round(performance.now() - startedAt);
  const rec: Rec = {
    no: qno,
    n: target,
    factors: [...entered],
    d: curDiff,
    ms,
    miss,
    perfect,
    base: probBase,
    pts: probPts,
    done: true
  };
  history.unshift(rec);
  solveLog.push(rec);
  progress += progressOf(curDiff);
  miss = 0;
  nextProblem();
}

function addGain(pts: number, perfect: boolean) {
  gainAcc += pts;
  const g = $("gain");
  g.textContent = `+${gainAcc.toLocaleString()}`;
  g.classList.toggle("perfect", perfect);
  g.classList.remove("bump");
  void g.offsetWidth; // アニメーション再始動
  g.classList.add("on", "bump");
  clearTimeout(gainTimer);
  gainTimer = window.setTimeout(() => {
    g.classList.remove("on", "bump"); // フェードアウト
    gainAcc = 0;
  }, GAIN_HOLD);
}

function setScoreTarget(to: number) {
  scoreFrom = scoreShown;
  scoreTo = to;
  tweenStart = performance.now();
  if (!raf) raf = requestAnimationFrame(stepScore);
}
function stepScore() {
  const t = Math.min(1, (performance.now() - tweenStart) / TWEEN_MS);
  scoreShown = scoreFrom + (scoreTo - scoreFrom) * (1 - (1 - t) ** 3);
  el.score.textContent = Math.round(scoreShown).toLocaleString();
  raf = t < 1 ? requestAnimationFrame(stepScore) : 0;
}

function showCombo(c: number) {
  comboShown = c;
  const box = $("combo");
  if (c < 2) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = "combo";
  box.innerHTML = `<b>${c}</b> COMBO`;
  void box.offsetWidth; // アニメーション再始動
  box.className = "combo bump";
}
function breakCombo() {
  const box = $("combo");
  comboShown = 0;
  if (box.hidden) return;
  box.className = "combo";
  void box.offsetWidth;
  box.className = "combo lost";
  box.addEventListener(
    "animationend",
    () => {
      if (comboShown === 0) {
        box.hidden = true;
        box.className = "combo";
      }
    },
    { once: true }
  );
}
function showBanner(id: "perfect" | "go") {
  const b = $(id);
  b.classList.remove("show");
  void b.offsetWidth; // アニメーション再始動
  b.classList.add("show");
}

function summarize(recs: Rec[]) {
  const n = recs.length;
  const sum = (f: (r: Rec) => number) => recs.reduce((s, r) => s + f(r), 0);
  return {
    solved: n,
    misses: sum((r) => r.miss),
    avgMs: n ? sum((r) => r.ms) / n : 0,
    maxD: n ? Math.max(...recs.map((r) => r.d)) : 0,
    maxPrime: n ? Math.max(...recs.flatMap((r) => r.factors)) : 0,
    best: n ? recs.reduce((a, b) => (b.pts > a.pts ? b : a)) : null,
    perfects: recs.filter((r) => r.perfect).length
  };
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") {
    if (phase === "idle") return; // タイトル画面の Enter は title.ts が処理
    e.preventDefault();
    if (phase === "play") return divide();
    // 時間切れ直後の連打で、リザルトを飛ばして再開しないようにする
    if (phase === "result" && performance.now() - resultAt >= 800) return beginCountdown();
    return;
  }
  if (!playing()) return;
  if (/^[0-9]$/.test(e.key)) return typeDigit(e.key);
  if (e.key === " ") {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur(); // フォーカス中のボタンの二重発火を防ぐ
    return commitBuf();
  }
  if (e.key === "Backspace") return buf ? backBuf() : undo();
  if (e.key === "Escape") return clearInput();
  const p = KEYMAP[e.key.toLowerCase()];
  if (p !== undefined && isUnlocked(p)) addPrime(p);
});

document.querySelectorAll<HTMLElement>(".prime-btn").forEach((b) => {
  const key = Object.keys(KEYMAP).find((k) => KEYMAP[k] === Number(b.dataset.prime));
  b.querySelector("kbd")!.textContent = key ? key.toUpperCase() : "";
});

$("trial").replaceChildren();
window.addEventListener("resize", render);

setInterval(tick, 16);

// --------------------------

function beginCountdown() {
  if (phase === "count" || phase === "play") return;
  phase = "count";
  $("screen-game").hidden = false;
  $("result").hidden = true;
  resetGame();

  const box = $("countdown"),
    num = $("count-num");
  box.hidden = false;
  ["3", "2", "1", "GO!"].forEach((t, i) =>
    later(i * COUNT_STEP, () => {
      if (t === "GO!") {
        box.hidden = true; // 3・2・1 の表示を消して問題を見せる
        startGame(); // ここで計測開始
        showBanner("go"); // PERFECT と同じ位置に GO! を表示
        return;
      }
      num.textContent = t;
      num.classList.remove("pop");
      void num.offsetWidth; // アニメーション再始動
      num.classList.add("pop");
    })
  );
}
function startGame() {
  phase = "play";
  gameStart = performance.now();
  $("result").hidden = true;
  nextProblem();
}

//カウントダウン時に行うinit
function resetGame() {
  gameId++; // 前のゲームの予約（ポップなど）を無効化。later はこの後に予約すること
  qno = 0;
  score = 0;
  miss = 0;
  progress = 0;
  combo = 0;
  maxCombo = 0;
  history.length = 0; // solveLog は校正用に保持
  target = 0;
  entered = [];
  committed = 0;
  buf = "";
  decides = 0;
  probPts = 0;
  probBase = 0;
  curDiff = 0;
  curStage = stageOf(0);
  scoreShown = scoreFrom = scoreTo = 0;
  el.score.textContent = "0";
  comboShown = 0;
  $("combo").hidden = true;
  clearTimeout(gainTimer);
  gainAcc = 0;
  $("gain").classList.remove("on", "bump");
  el.trial.replaceChildren();
  queueEndAt = 0;
  const [sec, frac] = (TIME_LIMIT / 1000).toFixed(3).split(".");
  el.timer.innerHTML = `${sec}<small>.${frac}</small>`;
  render();
}

function endGame() {
  phase = "result";
  resultAt = performance.now();
  const s = summarize(history);
  const prev = loadBest();
  const isNew = score > prev;
  if (isNew) saveBest(score);
  bestScore = Math.max(prev, score);
  $("final-score").textContent = score.toLocaleString();
  const rows: [string, string][] = [
    ["正解", `${s.solved}問`],
    ["PERFECT", `${s.perfects}回`],
    ["Miss", `${s.misses}回`],
    ["平均解答時間", `${(s.avgMs / 1000).toFixed(1)}s`],
    ["Max Combo", String(maxCombo)],
    ["最高難易度", s.maxD.toFixed(1)],
    ["最大の素因数", s.maxPrime ? String(s.maxPrime) : "-"],
    ["最高得点の問題", s.best ? `${s.best.n} (+${s.best.pts.toLocaleString()})` : "-"],
    ["ハイスコア", Math.max(prev, score).toLocaleString() + (isNew ? "  NEW" : "")]
  ];
  $("final-detail").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const list: Rec[] = [...history];
  list.unshift({
    no: qno,
    n: target,
    factors: curFactors,
    d: curDiff,
    ms: Math.round(performance.now() - startedAt),
    miss,
    perfect: false,
    base: probBase,
    pts: probPts,
    done: false
  });

  const ans = (r: Rec) => `= ${expo(r.factors, true)}`;
  $("final-list").innerHTML = list
    .map(
      (r) => `
  <li class="rd">
    <div class="rd-main">
      <span class="rd-no">Q${r.no}</span><b>${r.n}</b><span class="rd-ans">${ans(r)}</span>
      <span class="rd-d">難易度 ${r.d.toFixed(2)}</span>
    </div>
    <div class="rd-sub">
      <span class="${r.perfect ? "pf" : ""}">${r.done ? (r.perfect ? "PERFECT" : "") : "未完了"}</span>
      <span>${r.perfect ? "" : `MISS ${r.miss}`}</span>
      <span>${(r.ms / 1000).toFixed(2)}s</span>
    </div>
  <div class="rd-pts">${`基礎点 ${r.base.toLocaleString()} <i>(×${r.base ? (r.pts / r.base).toFixed(2) : "-"})</i> → <b>+${r.pts.toLocaleString()}</b>`}</div>  </li>`
    )
    .join("");
  $("result").hidden = false;
}

// main.ts — tick を置き換え（残り時間表示。問題ごとの経過は startedAt で別管理のまま）
function tick() {
  if (!playing()) return;
  const left = Math.max(0, TIME_LIMIT - (performance.now() - gameStart));
  // const m = Math.floor(left / 60000);
  // const s = ((left % 60000) / 1000).toFixed(1).padStart(4, "0");
  const [sec, frac] = (left / 1000).toFixed(3).split(".");
  el.timer.innerHTML = `${sec}<small>.${frac}</small>`;
  if (left <= 0) endGame();
}

$("btn-restart").addEventListener("click", startGame);
render();

//レイアウト関連
const bar = document.querySelector<HTMLElement>(".topbar")!;
const mq = matchMedia("(max-width: 700px)");

// スマホ幅は常に compact。それ以外はスクロール時のみ（縮小で高さが変わっても
// ちらつかないよう、入る閾値(48)と戻る閾値(4)を離している）
function updateBar() {
  const on = bar.classList.contains("compact");
  bar.classList.toggle("compact", mq.matches || (on ? scrollY > 16 : scrollY > 64));
}
addEventListener("scroll", updateBar, { passive: true });
mq.addEventListener("change", updateBar);

// トップバーの実際の高さを CSS 変数に渡す（問題パネルの sticky の位置に使用）
new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`)).observe(bar);
updateBar();

export function initGame(opt: { onExit: () => void }) {
  onExit = opt.onExit;
  return { start: beginCountdown };
}

function toTitle() {
  phase = "idle";
  gameId++;
  $("result").hidden = true;
  $("countdown").hidden = true;
  $("screen-game").hidden = true;
  onExit();
}
