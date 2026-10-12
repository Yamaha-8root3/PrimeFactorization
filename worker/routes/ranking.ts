// worker/routes/ranking.ts（新規）
import { json, readJson, type Handler } from "../http";
import { authedUser } from "../session";
import { RULESETS, RankedRules } from "../../src/shared/rules";
import { calcStats, type Result } from "../../src/screens/game/result";

const MAX_RECS = 200; // 仮
const MAX_BODY = 200_000; // 保存 JSON の最大文字数（仮）
const MODES = new Set(["solo", "multi"]);
const PLAY_TTL = 2 * 3600 * 1000; // 未使用セッションの保持期間

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
// const okSub = (s: any) => s && num(s.timeAdd) && num(s.startcombo) && Array.isArray(s.inputs) && s.inputs.length <= 64;
// const okRec = (r: any) => r && isInt(r.no, MAX_RECS) && isInt(r.miss, 1e6) && isInt(r.pts, Number.MAX_SAFE_INTEGER) && typeof r.done === "boolean" && Array.isArray(r.factors) && r.factors.length <= 64 && Array.isArray(r.submits) && r.submits.length <= 1000 && r.submits.every(okSub);

// 構造チェック（calcStats が安全に動く最低限）
const okSub = (s: any) => s && num(s.time) && num(s.score) && num(s.startcombo) && num(s.timeAdd) && Array.isArray(s.inputs) && s.inputs.length <= 64 && s.inputs.every((i: any) => num(i?.v) && (i.state === "ok" || i.state === "ng" || i.state === "skip"));
const okRec = (r: any) =>
  r &&
  isInt(r.no, MAX_RECS) &&
  num(r.n) &&
  num(r.d) &&
  num(r.ms) &&
  num(r.base) &&
  isInt(r.miss, 1e6) &&
  isInt(r.pts, Number.MAX_SAFE_INTEGER) &&
  typeof r.perfect === "boolean" &&
  typeof r.done === "boolean" &&
  Array.isArray(r.factors) &&
  r.factors.length <= 64 &&
  r.factors.every(num) &&
  Array.isArray(r.submits) &&
  r.submits.length <= 1000 &&
  r.submits.every(okSub);
const shapeOk = (b: Result) => typeof b.sessionId === "string" && b.sessionId.length >= 8 && b.sessionId.length <= 64 && MODES.has(b.mode) && isInt(b.seed, 0xffffffff) && isInt(b.playedAt, Number.MAX_SAFE_INTEGER) && Array.isArray(b.recs) && b.recs.length <= MAX_RECS && b.recs.every(okRec);

export const startPlay: Handler = async (req, env) => {
  const user = await authedUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const b = await readJson<{ rulesetId?: unknown; mode?: unknown }>(req);
  const rs = typeof b?.rulesetId === "string" ? RULESETS[b.rulesetId] : undefined;
  if (!rs?.ranked || typeof b?.mode !== "string" || !MODES.has(b.mode)) return json({ error: "invalid_mode" }, 400);

  const sessionId = crypto.randomUUID();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM play_sessions WHERE started_at < ?1").bind(now - PLAY_TTL),
    env.DB.prepare("INSERT INTO play_sessions (session_id, user_id, ruleset_id, rules_ver, mode, seed, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(sessionId, user.id, rs.id, rs.ver, b.mode, seed, now)
  ]);
  return json({ sessionId, seed });
};

// POST /api/score: 自己ベストのときだけ更新
export const submit: Handler = async (req, env) => {
  const user = await authedUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
  let b: Result;
  try {
    b = JSON.parse(text);
  } catch {
    return json({ error: "invalid_result" }, 400);
  }
  if (!b || typeof b !== "object") return json({ error: "invalid_result" }, 400);

  const rs = typeof b.rulesetId === "string" ? RULESETS[b.rulesetId] : undefined;
  if (!rs?.ranked || b.customRuleset) return json({ error: "invalid_mode" }, 400);
  if (b.rulesetVersion !== rs.ver) return json({ error: "rules_mismatch" }, 409);
  if (!shapeOk(b)) return json({ error: "invalid_result" }, 400);

  // 申告値は信用せず recs から再計算して照合
  const st = calcStats(b.recs);
  if (st.score !== b.stats?.score || st.solved !== b.stats?.solved) return json({ error: "stats_mismatch" }, 400);
  if (!isInt(st.score, Number.MAX_SAFE_INTEGER) || st.solved > MAX_RECS) return json({ error: "invalid_score" }, 400);

  // session
  const sess = await env.DB.prepare("SELECT ruleset_id, rules_ver, mode, seed, started_at FROM play_sessions WHERE session_id = ?1 AND user_id = ?2").bind(b.sessionId, user.id).first<{ ruleset_id: string; rules_ver: number; mode: string; seed: number; started_at: number }>();
  if (!sess) return json({ error: "no_session" }, 409);
  if (sess.ruleset_id !== rs.id || sess.rules_ver !== rs.ver || sess.mode !== b.mode || sess.seed !== b.seed) return json({ error: "session_mismatch" }, 409);

  // playTime(ms) は 制限時間 + 延長 と一致し、サーバー上の実経過がそれ以上であること
  const expect = rs.rules.time[b.mode].limitSec * 1000 + st.extendedTime * 1000;
  if (!num(b.playTime) || Math.abs(b.playTime - expect) > 200) return json({ error: "invalid_time" }, 400);
  if (Date.now() - sess.started_at < b.playTime - 1000) return json({ error: "too_fast" }, 400);

  // セッション消費（同時送信による二重使用を防ぐ）
  const del = await env.DB.prepare("DELETE FROM play_sessions WHERE session_id = ?1 AND user_id = ?2").bind(b.sessionId, user.id).run();
  if (!del.meta.changes) return json({ error: "no_session" }, 409);

  // 蓄積: 同一 sessionId の再送は弾く（ベスト更新より先に判定）
  const ins = await env.DB.prepare("INSERT INTO results (session_id, user_id, ruleset_id, rules_ver, mode, seed, score, solved, played_at, data) " + "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (session_id) DO NOTHING")
    .bind(b.sessionId, user.id, rs.id, rs.ver, b.mode, b.seed, st.score, st.solved, Date.now(), text)
    .run();
  if (!ins.meta.changes) return json({ error: "duplicate" }, 409);

  // best_scores の mode 列は従来どおり ruleset id を入れる（list / best が RULESETS[mode] で引くため）
  const [, cur] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO best_scores (user_id, mode, rules_ver, score, solved, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
        "ON CONFLICT (user_id, mode, rules_ver) DO UPDATE SET score = excluded.score, solved = excluded.solved, " +
        "updated_at = excluded.updated_at WHERE excluded.score > best_scores.score"
    ).bind(user.id, rs.id, rs.ver, st.score, st.solved, Date.now()),
    env.DB.prepare("SELECT score FROM best_scores WHERE user_id = ?1 AND mode = ?2 AND rules_ver = ?3").bind(user.id, rs.id, rs.ver)
  ]);
  const best = (cur.results[0] as { score: number }).score;
  return json({ best, isBest: best === st.score });
};

// GET /api/ranking?mode=&limit=: 上位N件。ログイン中なら自分の順位も返す
export const list: Handler = async (req, env) => {
  const q = new URL(req.url).searchParams;
  const mode = q.get("mode") ?? "";
  const rs = typeof mode === "string" ? RULESETS[mode] : undefined;
  if (!rs?.ranked) return json({ error: "invalid_mode" }, 400);
  const limit = Math.min(Math.max(Number(q.get("limit")) || 20, 1), 100);
  const user = await authedUser(req, env);

  const rows = await env.DB.prepare("SELECT u.display_name AS displayName, b.score, b.solved, b.user_id AS userId " + "FROM best_scores b JOIN users u ON u.id = b.user_id " + "WHERE b.mode = ?1 AND b.rules_ver = ?2 ORDER BY b.score DESC LIMIT ?3")
    .bind(mode, rs.ver, limit)
    .all<{ displayName: string; score: number; solved: number; userId: number }>();

  let prevScore = -1;
  let prevRank = 0;
  const entries = rows.results.map((r, i) => {
    const rank = r.score === prevScore ? prevRank : i + 1; // 同点は同順位
    prevScore = r.score;
    prevRank = rank;
    return { rank, displayName: r.displayName, score: r.score, solved: r.solved, mine: r.userId === user?.id };
  });

  let me: { rank: number; score: number; solved: number } | null = null;
  if (user) {
    const m = await env.DB.prepare("SELECT score, solved, (SELECT COUNT(*) + 1 FROM best_scores WHERE mode = ?1 AND rules_ver = ?2 AND score > b.score) AS rank " + "FROM best_scores b WHERE user_id = ?3 AND mode = ?1 AND rules_ver = ?2")
      .bind(mode, rs.ver, user.id)
      .first<{ score: number; solved: number; rank: number }>();
    if (m) me = m;
  }
  return json({ entries, me });
};

export const best: Handler = async (req, env) => {
  const user = await authedUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const rows = await env.DB.prepare("SELECT mode, rules_ver AS ver, score FROM best_scores WHERE user_id = ?1").bind(user.id).all<{ mode: string; ver: number; score: number }>();
  const bests: Record<string, number> = {};
  for (const r of rows.results) if (RULESETS[r.mode]?.ver === r.ver) bests[r.mode] = r.score;
  return json({ bests });
};
