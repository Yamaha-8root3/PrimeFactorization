import "./style.css";
import { generate, prod, progressOf, stageOf, PRIME_POOL, type Stage } from "./generator";
import { factorPoints } from "./score";
import html from "./game.html?raw";

//HTML構成
declare const __APP_VERSION__: string;
document.querySelector(".version")!.textContent = `v${__APP_VERSION__}`;
document.querySelector<HTMLDivElement>("#game")!.innerHTML = html;
const $ = (id: string) => document.getElementById(id)!;
// main.ts — ボタンの click 登録（素数ボタン・各操作ボタン）を置き換え
const press = (el: Element, fn: () => void) =>
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fn();
  });
press($("btn-divide"), divide);
press($("btn-undo"), undo);
press($("btn-clear"), clearInput);
press($("btn-restart"), startGame);

const isUnlocked = (p: number) => p <= stageOf(progress).maxPrime;
document.querySelectorAll<HTMLElement>(".prime-btn").forEach((b) =>
  press(b, () => {
    const p = Number(b.dataset.prime);
    if (isUnlocked(p)) addPrime(p);
  })
);
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
  trial: $("trial")
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

//変数
type Rec = { n: number; factors: number[]; d: number; ms: number; miss: number; pts: number; perfect: boolean };
const solveLog: { n: number; d: number; ms: number; miss: number }[] = [];
type Verdict = { v: number; state: "ok" | "ng" | "skip" };

const SCORE_VERSION = 1.1;

const TIME_LIMIT = 100_000; // ms
let running = false;
let gameStart = 0;
let gameId = 0;
const later = (ms: number, fn: () => void) => {
  const id = gameId;
  setTimeout(() => {
    if (id === gameId) fn();
  }, ms);
};

let target = 0;
let entered: number[] = [];
let committed = 0; // 仮決定済みの入力数

let combo = 0;
let comboShown = 0;
let maxCombo = 0;
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
  el.history.innerHTML = history.map((r) => `<li class="ok"><span>${r.n} = ${expo(r.factors, true)}</span><span>+${r.pts.toLocaleString()} · ${(r.ms / 1000).toFixed(1)}s</span></li>`).join("");
  el.diff.textContent = curDiff.toFixed(1);
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
  if (!running) return;
  entered.push(p);
  if (AUTO_FINISH && prod(entered) === target) finish(false);
  else render();
}

function clearInput() {
  if (!running) return;
  entered.length = committed;
  buf = "";
  render();
}

function undo() {
  if (!running) return;
  if (entered.length > committed) {
    entered.pop();
    render();
  }
}

function divide() {
  if (!running) return;
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
  if (perfect) showPerfect();

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
  const rec: Rec = { n: target, factors: [...entered], d: curDiff, ms, miss, pts: probPts, perfect };
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

function showPerfect() {
  const b = $("perfect");
  b.classList.remove("show");
  void b.offsetWidth;
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
const HS_KEY = `pf${SCORE_VERSION}.best`;
const loadBest = () => {
  try {
    return Number(localStorage.getItem(HS_KEY)) || 0;
  } catch {
    return 0;
  }
};
let bestScore = loadBest();
const saveBest = (v: number) => {
  try {
    localStorage.setItem(HS_KEY, String(v));
  } catch {}
};

document.querySelectorAll<HTMLElement>(".prime-btn").forEach((b) => b.addEventListener("click", () => addPrime(Number(b.dataset.prime))));
$("btn-divide").addEventListener("click", divide);
$("btn-undo").addEventListener("click", undo);
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") {
    e.preventDefault();
    return running ? divide() : startGame();
  }
  if (!running) return;
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

$("btn-clear").addEventListener("click", clearInput);
$("trial").replaceChildren();
window.addEventListener("resize", render);

setInterval(tick, 16);
// startGame(); // 初回は自動開始

// --------------------------

function startGame() {
  score = 0;
  miss = 0;
  progress = 0;
  combo = 0;
  maxCombo = 0;
  history.length = 0; // solveLog は校正用に保持

  gameId++;
  scoreShown = scoreFrom = scoreTo = 0;
  el.score.textContent = "0";
  comboShown = 0;
  $("combo").hidden = true;
  running = true;
  gameStart = performance.now();
  $("result").hidden = true;
  clearTimeout(gainTimer);
  gainAcc = 0;
  $("gain").classList.remove("on", "bump");
  nextProblem();
}

function endGame() {
  running = false;
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
  $("result").hidden = false;
}

// main.ts — tick を置き換え（残り時間表示。問題ごとの経過は startedAt で別管理のまま）
function tick() {
  if (!running) return;
  const left = Math.max(0, TIME_LIMIT - (performance.now() - gameStart));
  // const m = Math.floor(left / 60000);
  // const s = ((left % 60000) / 1000).toFixed(1).padStart(4, "0");
  const [sec, frac] = (left / 1000).toFixed(3).split(".");
  el.timer.innerHTML = `${sec}<small>.${frac}</small>`;
  if (left <= 0) endGame();
}

$("btn-restart").addEventListener("click", startGame);
render();
