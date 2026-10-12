import "./game.css";
// import { generate, prod, progressOf, stageOf, PRIME_POOL, type Stage } from "./generator";
// import { factorPoints, factorBase } from "./score";
import { loadBest, saveBest } from "../../shared/storage";
import { $, press } from "../../shared/dom";
import { submitScore, startPlay } from "../../shared/api";
import { currentUser } from "../title/account";
import { RULESETS, DEFAULT_ID, DEFAULT_RULES, type Decision, type ProblemLog, type RunResult, makeSetup, type GameSetup, RuleSet, Mode, DEFAULT_CONFIG } from "../../shared/rules";

import { Config } from "../../shared/rules";
import { Game } from "../../shared/game";
import { Problem, ProblemState } from "../../shared/gameengine";
import { calcStats, Rec, Result, Stats, SubmitResult, Verdict } from "./result";
import { renderStats } from "./resultView";

press($("btn-divide"), divide);
press($("btn-undo"), undo);
press($("btn-clear"), clearInput);
press($("btn-restart"), prepareNewGame);
press($("btn-title"), toTitle);
press($("btn-abort"), abortRun);

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

//変数

let MODE: Mode = "solo";
let RULESETID = DEFAULT_ID;
let setup: GameSetup = makeSetup(DEFAULT_ID, DEFAULT_CONFIG, "solo");
let CONFIG: Config = setup.config;
let game: Game = new Game(setup);
let TIME_LIMIT = game.timeLimitSec * 1000;

type Phase = "idle" | "count" | "play" | "end" | "result"; // idle = ゲーム画面が非表示（タイトル中）
let phase: Phase = "idle";
let resultAt = 0;
let onExit: () => void = () => {};
const COUNT_STEP = 800;
const END_DELAY = 1200; // ms
let endMs = 0; // 時間切れ時点の最終問題の経過時間
const RESULT_LOCK = 1000; // ms
let restartLocked = false;

// const solveLog: { n: number; d: number; ms: number; miss: number }[] = [];
// const runLog: ProblemLog[] = [];
// let curDec: Decision[] = [];

const playing = () => phase === "play";
let gameId = 0;
const later = (ms: number, fn: () => void) => {
  const id = gameId;
  setTimeout(() => {
    if (id === gameId) fn();
  }, ms);
};

let sessionId = "";
let startSeq = 0;
let starting = false;

let bestScore = 0;

let curProblemState: ProblemState | null = null;
let curProblem: Problem | null = null;
let curProbStartedAt = 0;
let curFactors: number[] = []; // 今の問題の正解（素因数分解）
let entered: number[] = [];
let committed = 0; // 仮決定済みの入力数

let startAt = 0;
let endAt = 0;
let qno = 0;
let combo = 0;
let comboShown = 0;
let probBase = 0; // この問題の基礎点の合計
let probPts = 0; // この問題で得た点

let score = 0;
let maxCombo = 0;
let decides = 0; // この問題での決定回数
let miss = 0;
// let progress = 0;

let submitResults: SubmitResult[] = [];
let records: Rec[] = [];
// let curStage: Stage = stageOf(0);
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

const keyOf = (p: number) =>
  Object.keys(KEYMAP)
    .find((k) => KEYMAP[k] === p)
    ?.toUpperCase() ?? "";
$("prime-buttons").innerHTML = game.usePrimes.map((p) => `<button class="prime-btn" data-prime="${p}"><span class="num">${p}</span><kbd>${keyOf(p)}</kbd></button>`).join("");

// const isUnlocked = (p: number) => p <= stageOf(progress).maxPrime;
document.querySelectorAll<HTMLElement>(".prime-btn").forEach((b) =>
  press(b, () => {
    const p = Number(b.dataset.prime);
    // if (isUnlocked(p)) addPrime(p);
    addPrime(p);
  })
);

const prod = (a: number[]) => a.reduce((x, y) => x * y, 1);

let abortTimer = 0;
// 2回押しで中断。記録・送信はせずタイトルへ戻る
function abortRun() {
  if (phase !== "play" && phase !== "count") return;
  if (!abortTimer) {
    $("btn-abort").textContent = "中断?";
    $("btn-abort").classList.add("armed");
    abortTimer = window.setTimeout(disarmAbort, 2000);
    return;
  }
  disarmAbort();
  toTitle();
}
function disarmAbort() {
  clearTimeout(abortTimer);
  abortTimer = 0;
  $("btn-abort").textContent = "✕";
  $("btn-abort").classList.remove("armed");
}

let finishing = false; // 終了処理中（リトライ不可）
let finishSeq = 0; // 古い送信の完了が新しいゲームのボタンを操作しないための番号
const setFinishing = (on: boolean) => {
  finishing = on;
};

const syncRestart = () => {
  ($("btn-restart") as HTMLButtonElement).disabled = finishing || restartLocked;
  ($("btn-title") as HTMLButtonElement).disabled = finishing || restartLocked;
};
function lockRestart(ms: number) {
  restartLocked = true;
  syncRestart();
  const my = finishSeq;
  setTimeout(() => {
    if (my !== finishSeq) return; // 別ゲームに移っていたら何もしない
    restartLocked = false;
    syncRestart();
  }, ms);
}

//素因数分解の整形テキスト生成
function expo(list: number[], html: boolean): string {
  const m = new Map<number, number>();
  [...list].sort((a, b) => a - b).forEach((p) => m.set(p, (m.get(p) ?? 0) + 1));
  return [...m].map(([p, c]) => (c === 1 ? `${p}` : html ? `${p}<sup>${c}</sup>` : `${p}^${c}`)).join("×");
}

function nextProblem() {
  qno++;
  curProblemState = game.next();
  curProblem = curProblemState.p;
  curFactors = curProblem.factors;
  probBase = curProblemState.total;
  // curStage = pb.stage;
  entered = [];
  buf = "";
  decides = 0;
  probPts = 0;
  committed = 0;
  curProbStartedAt = performance.now();
  submitResults = [];
  render();
}

function render() {
  el.qno.textContent = `Q${qno}`;
  if (curProblem) {
    el.target.textContent = String(curProblem.target / prod(entered.slice(0, committed)));
    el.originaltarget.textContent = String(curProblem.target);
    el.diff.textContent = curProblem?.d.toFixed(2);

    const row = (r: Rec) =>
      `<li><span class="h-no">${r.no}</span><span class="h-n">${r.n}</span>` + `<span class="h-d">${r.d.toFixed(2)}</span><span class="h-s">${r.perfect ? "★" : ""}</span>` + `<span class="h-p">+${r.pts.toLocaleString()}</span><span class="h-t">${(r.ms / 1000).toFixed(1)}s</span></li>`;
    // 最上段: 解いている途中の問題と途中得点
    const curRow = playing()
      ? `<li class="cur"><span class="h-no">${qno}</span><span class="h-n">${curProblem.target}</span>` + `<span class="h-d">${curProblem.d.toFixed(2)}</span><span class="h-s"></span>` + `<span class="h-p">+${probPts.toLocaleString()}</span><span class="h-t">…</span></li>`
      : "";
    const r = [...records];
    r.reverse();
    el.history.innerHTML = curRow + r.map(row).join("");
  } else {
    el.target.textContent = "";
    el.originaltarget.textContent = "";
  }
  // 回答欄は未確定分のみ
  el.answer.innerHTML = entered
    .slice(committed)
    .map((p) => `<span class="chip">${p}</span>`)
    .join("");
  // 確定分＋未確定分の整形済み表示
  const pending = entered.slice(committed);
  const bad = buf !== "" && !game.usePrimes.includes(Number(buf));
  const typing = buf ? `<span class="chip typing${bad ? " bad" : ""}">${buf}</span>` : "";
  el.answer.innerHTML = `<span class="ltr">${pending.map((p) => `<span class="chip">${p}</span>`).join("")}${typing}</span>`;
  el.expoInput.innerHTML = `<span class="ltr">${expo(pending, true)}</span>`;
  el.expoAll.innerHTML = `<span class="ltr">${expo(entered, true)}</span>`;
  el.err.hidden = true;
  el.score.textContent = score.toLocaleString();

  // el.range.textContent = `${curStage.dMin.toFixed(1)} – ${curStage.dMax.toFixed(1)}`;

  const st = summarize(records);
  el.stSolved.textContent = String(st.solved);
  el.stMiss.textContent = String(st.misses + miss); // 現在の問題の誤りも含む
  el.stAvg.textContent = st.solved ? `${(st.avgMs / 1000).toFixed(1)}s` : "-";
  el.stBest.textContent = bestScore.toLocaleString();
  // el.maxp.textContent = `≤ ${curStage.maxPrime}`;
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
  if (!game.usePrimes.includes(v)) {
    render();
    return;
  } else {
    addPrime(v);
  }
}

function addPrime(p: number) {
  if (!playing()) return;
  entered.push(p);
  if (AUTO_FINISH && prod(entered) === curProblem?.target) finish(false);
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
  if (!playing() || !curProblem || !curProblemState) return;
  commitBuf();
  const pending = entered.slice(committed);
  let result: SubmitResult = {
    time: performance.now() - curProbStartedAt,
    inputs: [],
    score: 0,
    startcombo: combo,
    timeAdd: 0
  };
  if (!pending.length) return;

  const r = game.submit(curProblemState, pending);
  const verdicts: Verdict[] = pending.map((v, i) => ({
    v,
    state: i < r.accepted ? "ok" : i === r.accepted && r.missed ? "ng" : "skip"
  }));
  result.inputs = verdicts;
  decides++;

  const ds = playTrial(verdicts);
  let run = score;
  r.factors.forEach((f, i) => {
    run += f.gain;
    const runNow = run;
    later(ds[i], () => {
      addGain(f.gain, r.perfect);
      setScoreTarget(runNow);
      showCombo(f.combo);
    });
  });
  if (r.missed) {
    later(ds[r.accepted], breakCombo);
    miss++;
  }
  if (r.factors.length) maxCombo = Math.max(maxCombo, r.factors[r.factors.length - 1].combo);
  if (r.timeAdd > 0) addTime(r.timeAdd);
  score += r.gain;
  probPts += r.gain;
  result.timeAdd = r.timeAdd;
  console.log(result.timeAdd);
  result.score = r.gain;
  submitResults.push(result);
  if (r.perfect) showBanner("perfect");

  entered.length = committed + r.accepted;
  committed = entered.length;
  if (r.done) finish(r.perfect);
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
  const ms = Math.round(performance.now() - curProbStartedAt);

  const fin = game.finish(curProblemState!, ms); // probElapsedSec: この問題の解答時間(秒)
  score += fin.bonus;
  probPts += fin.bonus;
  const rec: Rec = {
    no: qno,
    n: curProblem?.target || 0,
    factors: [...entered],
    d: curProblem?.d || 0,
    ms,
    miss,
    perfect,
    base: probBase,
    pts: probPts,
    done: true,
    submits: submitResults
  };
  console.log(submitResults);
  records.push(rec);
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

function addTime(sec: number) {
  endAt += sec * 1000;
  showTimeBonus(sec);
}

function showTimeBonus(sec: number) {
  const el = $("timeBonus");
  el.textContent = `+${sec}s`;
  el.classList.remove("show");
  void el.offsetWidth; // アニメーションの再起動
  el.classList.add("show");
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
function resetBanners() {
  //start Go
  ["perfect", "go"].forEach((id) => {
    const b = $(id);
    b.classList.remove("show");
    void b.offsetWidth;
  });
  //Combo
  const box = $("combo");
  box.hidden = true;
  box.className = "combo";
  void box.offsetWidth;
  //Time
  const el = $("timeBonus");
  el.classList.remove("show");
  void el.offsetWidth;
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
    if (phase === "result" && performance.now() - resultAt >= RESULT_LOCK) return prepareNewGame();
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
  // if (p !== undefined && isUnlocked(p)) addPrime(p);
  if (p !== undefined) addPrime(p);
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
  if ((phase === "result" && finishing) || phase === "count" || phase === "play") return;
  phase = "count";
  $("screen-game").hidden = false;
  $("result").hidden = true;
  if (!setup.config.showCountdown) {
    startGame(); // ここで計測開始
    return;
  }
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
  if (phase !== "count") return;

  phase = "play";
  startAt = performance.now();
  endAt = startAt + TIME_LIMIT;
  nextProblem();
}

//カウントダウン時に行うinit
function resetGame() {
  finishSeq++;

  setFinishing(false);
  restartLocked = false;
  gameId++; // 前のゲームの予約（ポップなど）を無効化。later はこの後に予約すること
  qno = 0;
  score = 0;
  miss = 0;
  combo = 0;
  maxCombo = 0;
  submitResults = [];
  records = [];
  entered = [];

  committed = 0;
  buf = "";
  decides = 0;
  probPts = 0;
  probBase = 0;
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

  bestScore = loadBest(setup.ruleset.id);

  disarmAbort();
  render();
}

function endGame() {
  phase = "result";
  setFinishing(true);
  resultAt = performance.now();
  const prev = loadBest(setup.ruleset.id);
  const isNew = score > prev;
  if (isNew) saveBest(setup.ruleset.id, score);
  bestScore = Math.max(prev, score);

  let finalProblemRec: Rec = {
    no: qno,
    n: curProblem?.target || 0,
    factors: curFactors,
    d: curProblem?.d || 0,
    ms: endMs,
    miss,
    perfect: false,
    base: probBase,
    pts: probPts,
    done: false,
    submits: submitResults
  };
  records.push(finalProblemRec);

  const result: Result = {
    sessionId: sessionId,
    rulesetId: setup.ruleset.id,
    rulesetVersion: setup.ruleset.ver,
    mode: setup.mode,
    customRuleset: undefined,
    seed: setup.seed,
    recs: records,
    stats: calcStats(records),
    playerId: currentUser?.id,
    playedAt: startAt,
    playTime: endAt - startAt
  };

  renderStats($("result-stats"), result, prev);

  const list: Rec[] = [...records];
  // 順番を反転
  list.reverse();

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
  console.log(result);

  if (currentUser && setup.ruleset.ranked && sessionId) {
    submitScore(result);
    setFinishing(false);
  } else setFinishing(false);

  lockRestart(RESULT_LOCK);
}

// main.ts — tick を置き換え（残り時間表示。問題ごとの経過は startedAt で別管理のまま）
function tick() {
  if (!playing()) return;
  const left = Math.max(0, endAt - performance.now());
  // const m = Math.floor(left / 60000);
  // const s = ((left % 60000) / 1000).toFixed(1).padStart(4, "0");
  const [sec, frac] = (left / 1000).toFixed(3).split(".");
  el.timer.innerHTML = `${sec}<small>.${frac}</small>`;
  if (left <= 0) {
    endMs = Math.round(performance.now() - curProbStartedAt);
    divide(); // playing() が true のうちに最後の入力を確定
    phase = "end";
    later(END_DELAY, endGame);
  }
}

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
  return { start: prepareNewGame };
}

async function prepareNewGame(rulesetid?: string, config?: Config, mode: Mode = "solo") {
  if (starting) return;
  const my = ++startSeq;
  $("result").hidden = true;
  resetGame();
  resetBanners();
  if (rulesetid) RULESETID = rulesetid;
  if (config) CONFIG = config;
  if (mode) MODE = mode;
  setup = makeSetup(RULESETID, CONFIG, MODE);
  sessionId = "";
  if (currentUser && setup.ruleset.ranked) {
    starting = true;
    const s = await startPlay(setup.ruleset.id, setup.mode);
    starting = false;
    if (my !== startSeq) return; // 待機中にタイトルへ戻った
    if ("error" in s)
      console.warn("play/start:", s.error); // ローカル seed のまま（送信なし）
    else {
      setup = { ...setup, seed: s.seed };
      sessionId = s.sessionId;
    }
  }
  game = new Game(setup);
  TIME_LIMIT = game.timeLimitSec * 1000;
  beginCountdown();
}

function toTitle() {
  startSeq++;
  starting = false;
  phase = "idle";
  gameId++;
  $("result").hidden = true;
  $("countdown").hidden = true;
  $("screen-game").hidden = true;
  onExit();
}
