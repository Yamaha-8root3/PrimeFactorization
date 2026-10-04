import { newToken, sha256Hex } from './crypto';
import { bearer } from './http';

const SESSION_MS = 30 * 24 * 3600 * 1000;
export type SessionUser = { id: number; username: string; displayName: string; role: string };

export async function startSession(env: Env, user: SessionUser) {
  const token = newToken();
  const now = Date.now();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now).run();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), user.id, now, now + SESSION_MS)
    .run();
  return { token, user };
}

export async function authedUser(req: Request, env: Env): Promise<SessionUser | null> {
  const t = bearer(req);
  if (!t) return null;
  return env.DB.prepare(
    'SELECT u.id, u.username, u.display_name AS displayName, u.role ' +
      'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2',
  )
    .bind(await sha256Hex(t), Date.now())
    .first<SessionUser>();
}

export async function endSession(env: Env, token: string) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
    .bind(await sha256Hex(token))
    .run();
}
