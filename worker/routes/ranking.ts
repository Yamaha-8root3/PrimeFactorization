// worker/routes/ranking.ts（新規）
import { json, readJson, type Handler } from "../http";
import { authedUser } from "../session";
import { RULESETS } from "../../src/shared/rules";

export const RULES_VER = 1;
const MODES = new Set(["normal-100s"]); // 仮のモード名。実際のモードに合わせる
const MAX_SOLVED = 1000; // 仮の上限

const isInt = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

// POST /api/score: 自己ベストのときだけ更新
export const submit: Handler = async (req, env) => {
  const user = await authedUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const b = await readJson<Record<string, unknown>>(req);

  const mode = b?.mode;
  const rs = typeof mode === "string" ? RULESETS[mode] : undefined;
  if (!rs?.ranked) return json({ error: "invalid_mode" }, 400);
  if (b?.rulesVer !== rs.ver) return json({ error: "rules_mismatch" }, 409);
  if (!isInt(b?.score, Number.MAX_SAFE_INTEGER) || !isInt(b?.solved, MAX_SOLVED)) return json({ error: "invalid_score" }, 400);

  const [, cur] = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO best_scores (user_id, mode, rules_ver, score, solved, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
        "ON CONFLICT (user_id, mode, rules_ver) DO UPDATE SET score = excluded.score, solved = excluded.solved, " +
        "updated_at = excluded.updated_at WHERE excluded.score > best_scores.score"
    ).bind(user.id, mode, rs.ver, b.score, b.solved, Date.now()),
    env.DB.prepare("SELECT score FROM best_scores WHERE user_id = ?1 AND mode = ?2 AND rules_ver = ?3").bind(user.id, mode, rs.ver)
  ]);
  const best = (cur.results[0] as { score: number }).score;
  return json({ best, isBest: best === b.score });
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
