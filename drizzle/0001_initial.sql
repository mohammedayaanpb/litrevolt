-- Runtime migration reference for LitRevolt 0.1.0.
-- The executable applies the equivalent idempotent statements in
-- src/main/database/database.ts so packaged startup has no external SQL dependency.

CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE papers (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, authors TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '',
  abstract TEXT NOT NULL DEFAULT '', original_name TEXT NOT NULL, managed_path TEXT NOT NULL UNIQUE,
  file_hash TEXT NOT NULL UNIQUE, page_count INTEGER NOT NULL, searchable INTEGER NOT NULL,
  extracted_text TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE paper_projects (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, project_id)
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, status TEXT NOT NULL,
  current_pass INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '', critical_review TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE pass_progress (
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, pass INTEGER NOT NULL,
  status TEXT NOT NULL, notes_json TEXT NOT NULL DEFAULT '{}', started_at TEXT, completed_at TEXT,
  PRIMARY KEY (review_id, pass)
);
CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, pass INTEGER NOT NULL,
  questions_json TEXT NOT NULL, answers_json TEXT NOT NULL DEFAULT '{}', grading_json TEXT, score REAL,
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE writing_evaluations (
  id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  submission TEXT NOT NULL, evaluation_json TEXT NOT NULL, score REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE annotations (
  id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE, page INTEGER NOT NULL, kind TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '', color TEXT NOT NULL,
  rects_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
