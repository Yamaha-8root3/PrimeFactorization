import { json, readJson, bearer, type Handler } from "../http";
import { hashPassword, verifyPassword } from "../crypto";
import { startSession, authedUser, endSession, type SessionUser } from "../session";

const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const DISPLAY_RE = /^[^\p{C}]{1,16}$/u;
const validPassword = (p: string) => p.length >= 5 && p.length <= 128;

async function readCreds(req: Request) {
  const b = await readJson<{ username?: unknown; password?: unknown; displayName?: unknown }>(req);
  if (typeof b?.username !== "string" || typeof b?.password !== "string") return null;
  const username = b.username.trim();
  const dn = typeof b.displayName === "string" ? b.displayName.trim() : "";
  return { username, password: b.password, displayName: dn || username };
}

export const signup: Handler = async (req, env) => {
  const c = await readCreds(req);
  if (!c) return json({ error: "bad_request" }, 400);
  if (!USER_RE.test(c.username)) return json({ error: "invalid_username" }, 400);
  if (!DISPLAY_RE.test(c.displayName)) return json({ error: "invalid_display_name" }, 400);
  if (!validPassword(c.password)) return json({ error: "invalid_password" }, 400);
  try {
    const r = await env.DB.prepare("INSERT INTO users (username, username_lower, display_name, password_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(c.username, c.username.toLowerCase(), c.displayName, await hashPassword(c.password), Date.now())
      .run();
    const user: SessionUser = { id: r.meta.last_row_id, username: c.username, displayName: c.displayName, role: "user" };
    return json(await startSession(env, user), 201);
  } catch (e) {
    if (String(e).includes("UNIQUE")) return json({ error: "username_taken" }, 409);
    throw e;
  }
};

let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword("not-a-real-password"));

export const login: Handler = async (req, env) => {
  const c = await readCreds(req);
  if (!c) return json({ error: "bad_request" }, 400);
  const row = await env.DB.prepare("SELECT id, username, display_name AS displayName, role, password_hash FROM users WHERE username_lower = ?1").bind(c.username.toLowerCase()).first<SessionUser & { password_hash: string }>();
  const ok = await verifyPassword(c.password, row?.password_hash ?? (await dummyHash()));
  if (!row || !ok) return json({ error: "invalid_credentials" }, 401);
  const user: SessionUser = { id: row.id, username: row.username, displayName: row.displayName, role: row.role };
  return json(await startSession(env, user));
};

export const logout: Handler = async (req, env) => {
  const t = bearer(req);
  if (t) await endSession(env, t);
  return json({ ok: true });
};

export const me: Handler = async (req, env) => {
  const u = await authedUser(req, env);
  return u ? json({ user: u }) : json({ error: "unauthorized" }, 401);
};

// ログイン中のパスワード変更（詳細は 3 を参照）
export const changePassword: Handler = async (req, env) => {
  const user = await authedUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  const b = await readJson<{ current?: unknown; next?: unknown }>(req);
  if (typeof b?.current !== "string" || typeof b?.next !== "string") return json({ error: "bad_request" }, 400);
  if (!validPassword(b.next)) return json({ error: "invalid_password" }, 400);
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(b.current, row.password_hash))) return json({ error: "invalid_credentials" }, 401);
  await env.DB.batch([
    // 1つの処理としてまとめて実行される
    env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(b.next), user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id) // 全端末のセッションを破棄
  ]);
  return json(await startSession(env, user));
};
