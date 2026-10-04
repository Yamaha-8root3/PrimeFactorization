-- Migration number: 0003 	 2026-10-04T11:28:13.307Z
CREATE TABLE best_scores (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode       INTEGER NOT NULL,
  rules_ver  INTEGER NOT NULL,
  score      INTEGER NOT NULL,
  solved     INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode, rules_ver)
);
CREATE INDEX idx_best_rank ON best_scores(mode, rules_ver, score DESC);