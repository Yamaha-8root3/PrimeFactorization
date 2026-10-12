-- Migration number: 0004 	 2026-10-11T14:09:47.206Z
CREATE TABLE results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ruleset_id TEXT NOT NULL,
  rules_ver  INTEGER NOT NULL,
  mode       TEXT NOT NULL,
  seed       INTEGER NOT NULL,
  score      INTEGER NOT NULL,
  solved     INTEGER NOT NULL,
  played_at  INTEGER NOT NULL,
  data       TEXT NOT NULL
);
CREATE INDEX idx_results_user ON results(user_id, played_at DESC);

CREATE TABLE play_sessions (
  session_id TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ruleset_id TEXT NOT NULL,
  rules_ver  INTEGER NOT NULL,
  mode       TEXT NOT NULL,
  seed       INTEGER NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE INDEX idx_play_started ON play_sessions(started_at);