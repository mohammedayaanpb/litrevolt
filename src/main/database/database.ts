import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  AiProvenance,
  Annotation,
  AnnotationInput,
  AnnotationKind,
  LibrarySnapshot,
  Paper,
  PaperUpdateInput,
  PassNumber,
  Project,
  QuizAttempt,
  Review,
  ReviewSummary,
  WritingEvaluation,
} from '../../shared/types';
import { isValidHighlightRect, MAX_HIGHLIGHT_RECTS, readHighlightRects } from '../../shared/highlights';
import { calculateUnderstandingScore } from '../../shared/workflow';

type SqliteDatabase = Database.Database;
type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

// Summaries intentionally avoid loading PDF metadata, pass notes, quiz answers,
// or evaluation JSON for every row in the full reviews collection.
const reviewSummaryQuery = `SELECT r.id, r.name, r.paper_id, r.project_id, r.status, r.current_pass,
  r.created_at, r.updated_at, p.title AS paper_title, project.name AS project_name,
  (SELECT score FROM quiz_attempts WHERE review_id = r.id AND pass = 1 ORDER BY created_at DESC, rowid DESC LIMIT 1) AS pass1_score,
  (SELECT score FROM quiz_attempts WHERE review_id = r.id AND pass = 2 ORDER BY created_at DESC, rowid DESC LIMIT 1) AS pass2_score,
  (SELECT score FROM quiz_attempts WHERE review_id = r.id AND pass = 3 ORDER BY created_at DESC, rowid DESC LIMIT 1) AS pass3_score,
  (SELECT score FROM writing_evaluations WHERE review_id = r.id AND kind = 'summary' AND submission = r.summary
    ORDER BY created_at DESC, rowid DESC LIMIT 1) AS summary_score,
  (SELECT score FROM writing_evaluations WHERE review_id = r.id AND kind = 'critical-review' AND submission = r.critical_review
    ORDER BY created_at DESC, rowid DESC LIMIT 1) AS critical_score
  FROM reviews r JOIN papers p ON p.id = r.paper_id LEFT JOIN projects project ON project.id = r.project_id`;

export interface ImportedPaperRecord {
  id: string;
  title: string;
  authors: string;
  year: string;
  abstract: string;
  originalName: string;
  managedPath: string;
  fileHash: string;
  pageCount: number;
  searchable: boolean;
  extractedText: string;
}

export class LitRevoltDatabase {
  private db: SqliteDatabase;

  constructor(readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '',
        year TEXT NOT NULL DEFAULT '',
        abstract TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL,
        managed_path TEXT NOT NULL UNIQUE,
        file_hash TEXT NOT NULL UNIQUE,
        page_count INTEGER NOT NULL,
        searchable INTEGER NOT NULL,
        extracted_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paper_projects (
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY (paper_id, project_id)
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'in-progress',
        current_pass INTEGER NOT NULL DEFAULT 1,
        summary TEXT NOT NULL DEFAULT '',
        critical_review TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pass_progress (
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        pass INTEGER NOT NULL,
        status TEXT NOT NULL,
        notes_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT,
        completed_at TEXT,
        PRIMARY KEY (review_id, pass)
      );
      CREATE TABLE IF NOT EXISTS quiz_attempts (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        pass INTEGER NOT NULL,
        questions_json TEXT NOT NULL,
        answers_json TEXT NOT NULL DEFAULT '{}',
        grading_json TEXT,
        score REAL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS quiz_review_pass ON quiz_attempts(review_id, pass, created_at DESC);
      CREATE TABLE IF NOT EXISTS writing_evaluations (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        submission TEXT NOT NULL,
        evaluation_json TEXT NOT NULL,
        score REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS writing_review_kind ON writing_evaluations(review_id, kind, created_at DESC);
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
        page INTEGER NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#F2C14E',
        rects_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `);
    const annotationColumns = this.db.prepare('PRAGMA table_info(annotations)').all() as Row[];
    if (!annotationColumns.some((column) => column.name === 'rects_json')) {
      this.db.exec("ALTER TABLE annotations ADD COLUMN rects_json TEXT NOT NULL DEFAULT '[]'");
    }
    this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'))");
    this.db.transaction(() => {
      const reviewColumns = this.db.prepare('PRAGMA table_info(reviews)').all() as Row[];
      if (!reviewColumns.some((column) => column.name === 'name')) {
        this.db.exec("ALTER TABLE reviews ADD COLUMN name TEXT NOT NULL DEFAULT ''");
      }
      // Number each paper's existing reviews by creation order; reopening must
      // preserve user-chosen names and all original timestamps and review data.
      this.db.exec(`WITH numbered AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY paper_id ORDER BY created_at, rowid) AS number FROM reviews
        ) UPDATE reviews SET name = 'Review ' || (SELECT number FROM numbered WHERE numbered.id = reviews.id)
        WHERE trim(name) = '';
        CREATE INDEX IF NOT EXISTS reviews_updated ON reviews(updated_at DESC);
        CREATE INDEX IF NOT EXISTS reviews_paper_updated ON reviews(paper_id, updated_at DESC);
        INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'));
      `);
    })();
    this.db.transaction(() => {
      const quizColumns = this.db.prepare('PRAGMA table_info(quiz_attempts)').all() as Row[];
      for (const column of ['generation_provenance_json', 'grading_provenance_json']) {
        if (!quizColumns.some((item) => item.name === column)) {
          this.db.exec(`ALTER TABLE quiz_attempts ADD COLUMN ${column} TEXT`);
        }
      }
      const writingColumns = this.db.prepare('PRAGMA table_info(writing_evaluations)').all() as Row[];
      if (!writingColumns.some((column) => column.name === 'provenance_json')) {
        this.db.exec('ALTER TABLE writing_evaluations ADD COLUMN provenance_json TEXT');
      }
      // Historical model identities cannot be inferred from current settings.
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'))");
    })();
  }

  getSetting(key: string, fallback = ''): string {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Row | undefined;
    return typeof row?.value === 'string' ? row.value : fallback;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO app_settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  setSettings(values: Record<string, string>): void {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) this.setSetting(key, value);
    })();
  }

  private mapPaper(row: Row): Paper {
    const projectRows = this.db.prepare('SELECT project_id FROM paper_projects WHERE paper_id = ?').all(row.id) as Row[];
    const reviewRow = this.db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE paper_id = ?').get(row.id) as Row;
    const activeQuiz = this.db.prepare(`SELECT qa.review_id FROM quiz_attempts qa
      JOIN reviews r ON r.id = qa.review_id WHERE r.paper_id = ? AND qa.completed_at IS NULL
      ORDER BY qa.created_at DESC LIMIT 1`).get(row.id) as Row | undefined;
    return {
      id: String(row.id), title: String(row.title), authors: String(row.authors), year: String(row.year),
      abstract: String(row.abstract), originalName: String(row.original_name), pageCount: Number(row.page_count),
      searchable: Boolean(row.searchable), projectIds: projectRows.map((item) => String(item.project_id)),
      reviewCount: Number(reviewRow.count), activeQuizReviewId: activeQuiz ? String(activeQuiz.review_id) : null, createdAt: String(row.created_at),
    };
  }

  getPaper(id: string): Paper {
    const row = this.db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Paper not found.');
    return this.mapPaper(row);
  }

  getPaperSource(id: string): { managedPath: string; extractedText: string; searchable: boolean; title: string; pageCount: number } {
    const row = this.db.prepare('SELECT managed_path, extracted_text, searchable, title, page_count FROM papers WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Paper not found.');
    return { managedPath: String(row.managed_path), extractedText: String(row.extracted_text), searchable: Boolean(row.searchable), title: String(row.title), pageCount: Number(row.page_count) };
  }

  findPaperByHash(fileHash: string): Paper | null {
    const row = this.db.prepare('SELECT * FROM papers WHERE file_hash = ?').get(fileHash) as Row | undefined;
    return row ? this.mapPaper(row) : null;
  }

  insertPaper(record: ImportedPaperRecord, projectId?: string): Paper {
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO papers
        (id, title, authors, year, abstract, original_name, managed_path, file_hash, page_count, searchable, extracted_text, created_at, updated_at)
        VALUES (@id, @title, @authors, @year, @abstract, @originalName, @managedPath, @fileHash, @pageCount, @searchable, @extractedText, @createdAt, @updatedAt)`)
        .run({ ...record, searchable: record.searchable ? 1 : 0, createdAt: timestamp, updatedAt: timestamp });
      if (projectId) this.db.prepare('INSERT INTO paper_projects(paper_id, project_id) VALUES (?, ?)').run(record.id, projectId);
    });
    transaction();
    return this.getPaper(record.id);
  }

  updatePaper(id: string, input: PaperUpdateInput): Paper {
    const current = this.getPaper(id);
    const title = (input.title ?? current.title).trim();
    if (!title) throw new Error('Paper title is required.');
    const transaction = this.db.transaction(() => {
      this.db.prepare(`UPDATE papers SET title = ?, authors = ?, year = ?, abstract = ?, updated_at = ? WHERE id = ?`)
        .run(title, (input.authors ?? current.authors).trim(), (input.year ?? current.year).trim(),
          (input.abstract ?? current.abstract).trim(), now(), id);
      if (input.projectIds !== undefined) this.replacePaperProjects(id, input.projectIds);
    });
    transaction();
    return this.getPaper(id);
  }

  deletePaper(id: string): string {
    const source = this.getPaperSource(id);
    this.db.prepare('DELETE FROM papers WHERE id = ?').run(id);
    return source.managedPath;
  }

  setPaperProjects(paperId: string, projectIds: string[]): void {
    this.getPaper(paperId);
    const transaction = this.db.transaction(() => {
      this.replacePaperProjects(paperId, projectIds);
    });
    transaction();
  }

  private replacePaperProjects(paperId: string, projectIds: string[]): void {
    this.db.prepare('DELETE FROM paper_projects WHERE paper_id = ?').run(paperId);
    const insert = this.db.prepare('INSERT INTO paper_projects(paper_id, project_id) VALUES (?, ?)');
    for (const projectId of [...new Set(projectIds)]) insert.run(paperId, projectId);
  }

  private mapProject(row: Row): Project {
    return {
      id: String(row.id), name: String(row.name), description: String(row.description),
      paperCount: Number(row.paper_count ?? 0), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  createProject(input: { name: string; description: string }): Project {
    const name = input.name.trim();
    if (!name) throw new Error('Project name is required.');
    const id = crypto.randomUUID();
    const timestamp = now();
    this.db.prepare('INSERT INTO projects(id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, input.description.trim(), timestamp, timestamp);
    return this.getProject(id);
  }

  getProject(id: string): Project {
    const row = this.db.prepare(`SELECT p.*, COUNT(pp.paper_id) AS paper_count FROM projects p
      LEFT JOIN paper_projects pp ON pp.project_id = p.id WHERE p.id = ? GROUP BY p.id`).get(id) as Row | undefined;
    if (!row) throw new Error('Project not found.');
    return this.mapProject(row);
  }

  updateProject(id: string, input: { name: string; description: string }): Project {
    if (!input.name.trim()) throw new Error('Project name is required.');
    this.db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(input.name.trim(), input.description.trim(), now(), id);
    return this.getProject(id);
  }

  deleteProject(id: string): void { this.db.prepare('DELETE FROM projects WHERE id = ?').run(id); }

  getLibrary(): LibrarySnapshot {
    const papers = (this.db.prepare('SELECT * FROM papers ORDER BY created_at DESC').all() as Row[]).map((row) => this.mapPaper(row));
    const projects = (this.db.prepare(`SELECT p.*, COUNT(pp.paper_id) AS paper_count FROM projects p
      LEFT JOIN paper_projects pp ON pp.project_id = p.id GROUP BY p.id ORDER BY p.updated_at DESC`).all() as Row[])
      .map((row) => this.mapProject(row));
    const recentRows = this.db.prepare(`${reviewSummaryQuery} ORDER BY r.updated_at DESC, r.rowid DESC LIMIT 8`).all() as Row[];
    const recentReviews = recentRows.map((row) => this.mapReviewSummary(row));
    return { papers, projects, recentReviews };
  }

  listReviews(): ReviewSummary[] {
    const rows = this.db.prepare(`${reviewSummaryQuery} ORDER BY r.updated_at DESC, r.rowid DESC`).all() as Row[];
    return rows.map((row) => this.mapReviewSummary(row));
  }

  listReviewsForPaper(paperId: string): ReviewSummary[] {
    this.getPaper(paperId);
    const rows = this.db.prepare(`${reviewSummaryQuery} WHERE r.paper_id = ? ORDER BY r.updated_at DESC, r.rowid DESC`).all(paperId) as Row[];
    return rows.map((row) => this.mapReviewSummary(row));
  }

  private mapReviewSummary(row: Row): ReviewSummary {
    const score = (value: unknown) => value == null ? null : Number(value);
    return {
      id: String(row.id), name: String(row.name), paperId: String(row.paper_id), paperTitle: String(row.paper_title),
      projectId: row.project_id ? String(row.project_id) : null, projectName: row.project_name == null ? null : String(row.project_name),
      status: String(row.status) as Review['status'], currentPass: Number(row.current_pass) as PassNumber,
      score: calculateUnderstandingScore({ pass1: score(row.pass1_score), pass2: score(row.pass2_score), pass3: score(row.pass3_score),
        summary: score(row.summary_score), criticalReview: score(row.critical_score) }).total,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  renameReview(id: string, rawName: string): ReviewSummary {
    if (typeof rawName !== 'string' || !rawName.trim()) throw new Error('Review name is required.');
    const name = rawName.trim();
    if (name.length > 200) throw new Error('Review name must be 200 characters or fewer.');
    const result = this.db.prepare('UPDATE reviews SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
    if (result.changes === 0) throw new Error('Review not found.');
    const row = this.db.prepare(`${reviewSummaryQuery} WHERE r.id = ?`).get(id) as Row;
    return this.mapReviewSummary(row);
  }

  deleteReview(id: string): void {
    // Foreign keys cascade only data owned by this review. The paper, its
    // project memberships, global annotations, and other reviews remain intact.
    const result = this.db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error('Review not found.');
  }

  startReview(paperId: string, projectId?: string): string {
    const paper = this.getPaper(paperId);
    if (projectId && !paper.projectIds.includes(projectId)) {
      throw new Error('Assign this paper to the selected project before starting a project review.');
    }
    const id = crypto.randomUUID();
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT name FROM reviews WHERE paper_id = ?').all(paperId) as Row[];
      const number = existing.reduce((highest, row) => {
        const match = /^Review ([1-9]\d*)$/.exec(String(row.name));
        const candidate = match ? Number(match[1]) : 0;
        return Number.isSafeInteger(candidate) ? Math.max(highest, candidate) : highest;
      }, existing.length) + 1;
      this.db.prepare(`INSERT INTO reviews(id, name, paper_id, project_id, status, current_pass, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'in-progress', 1, ?, ?)`).run(id, `Review ${number}`, paperId, projectId ?? null, timestamp, timestamp);
      const insert = this.db.prepare(`INSERT INTO pass_progress(review_id, pass, status, notes_json, started_at)
        VALUES (?, ?, ?, '{}', ?)`);
      insert.run(id, 1, 'in-progress', timestamp);
      insert.run(id, 2, 'locked', null);
      insert.run(id, 3, 'locked', null);
    });
    transaction();
    return id;
  }

  savePassNotes(reviewId: string, pass: PassNumber, notes: Record<string, string>): void {
    this.db.prepare('UPDATE pass_progress SET notes_json = ?, status = CASE WHEN status = \'available\' THEN \'in-progress\' ELSE status END, started_at = COALESCE(started_at, ?) WHERE review_id = ? AND pass = ?')
      .run(JSON.stringify(notes), now(), reviewId, pass);
    this.touchReview(reviewId);
  }

  saveQuiz(reviewId: string, pass: PassNumber, questions: unknown[], provenance: AiProvenance | null = null): string {
    const id = crypto.randomUUID();
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM quiz_attempts WHERE review_id = ? AND pass = ? AND completed_at IS NULL').run(reviewId, pass);
      this.db.prepare(`INSERT INTO quiz_attempts(id, review_id, pass, questions_json, generation_provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, reviewId, pass, JSON.stringify(questions), provenance ? JSON.stringify(provenance) : null, now());
      this.touchReview(reviewId);
    });
    transaction();
    return id;
  }

  saveQuizAnswers(attemptId: string, answers: Record<string, string>): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT review_id, completed_at FROM quiz_attempts WHERE id = ?').get(attemptId) as Row | undefined;
      if (!row) throw new Error('Quiz attempt not found.');
      if (row.completed_at) throw new Error('This quiz attempt has already been submitted.');
      this.db.prepare('UPDATE quiz_attempts SET answers_json = ? WHERE id = ?').run(JSON.stringify(answers), attemptId);
      this.touchReview(String(row.review_id));
    })();
  }

  gradeQuiz(attemptId: string, answers: Record<string, string>, grading: unknown, score: number, provenance: AiProvenance | null = null): void {
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Quiz score must be between 0 and 100.');
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare('SELECT review_id, completed_at FROM quiz_attempts WHERE id = ?').get(attemptId) as Row | undefined;
      if (!row) throw new Error('Quiz attempt not found.');
      if (row.completed_at) throw new Error('This quiz attempt has already been submitted.');
      this.db.prepare(`UPDATE quiz_attempts SET answers_json = ?, grading_json = ?, score = ?, grading_provenance_json = ?, completed_at = ? WHERE id = ?`)
        .run(JSON.stringify(answers), JSON.stringify(grading), score, provenance ? JSON.stringify(provenance) : null, now(), attemptId);
      this.touchReview(String(row.review_id));
    });
    transaction();
  }

  completePass(reviewId: string, pass: PassNumber): void {
    const progress = this.db.prepare('SELECT status FROM pass_progress WHERE review_id = ? AND pass = ?').get(reviewId, pass) as Row | undefined;
    if (!progress || progress.status === 'locked') throw new Error('This pass is still locked.');
    const quiz = this.getLatestQuiz(reviewId, pass);
    if (!quiz?.grading) throw new Error('Complete and submit the closed-book quiz before finishing this pass.');
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`UPDATE pass_progress SET status = 'complete', completed_at = ? WHERE review_id = ? AND pass = ?`)
        .run(timestamp, reviewId, pass);
      if (pass < 3) {
        this.db.prepare(`UPDATE pass_progress SET status = 'available' WHERE review_id = ? AND pass = ?`).run(reviewId, pass + 1);
        this.db.prepare('UPDATE reviews SET current_pass = ?, updated_at = ? WHERE id = ?').run(pass + 1, timestamp, reviewId);
      } else {
        this.db.prepare(`UPDATE reviews SET status = 'writing', updated_at = ? WHERE id = ?`).run(timestamp, reviewId);
      }
    });
    transaction();
  }

  saveWriting(reviewId: string, kind: 'summary' | 'critical-review', text: string): void {
    const column = kind === 'summary' ? 'summary' : 'critical_review';
    this.db.transaction(() => {
      this.db.prepare(`UPDATE reviews SET ${column} = ?, updated_at = ? WHERE id = ?`).run(text, now(), reviewId);
      this.syncWritingCompletion(reviewId);
    })();
  }

  saveWritingEvaluation(reviewId: string, kind: 'summary' | 'critical-review', submission: string, evaluation: unknown, score: number, provenance: AiProvenance | null = null): void {
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Writing score must be between 0 and 100.');
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO writing_evaluations(id, review_id, kind, submission, evaluation_json, score, provenance_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), reviewId, kind, submission, JSON.stringify(evaluation), score, provenance ? JSON.stringify(provenance) : null, now());
      this.syncWritingCompletion(reviewId);
    })();
  }

  private syncWritingCompletion(reviewId: string): void {
    const review = this.getReview(reviewId);
    if (review.passes.some((pass) => pass.status !== 'complete')) {
      this.touchReview(reviewId);
      return;
    }
    const timestamp = now();
    this.db.prepare('UPDATE reviews SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(review.score.complete ? 'complete' : 'writing', review.score.complete ? review.completedAt ?? timestamp : null, timestamp, reviewId);
  }

  private getLatestQuiz(reviewId: string, pass: PassNumber): QuizAttempt | null {
    const row = this.db.prepare(`SELECT * FROM quiz_attempts WHERE review_id = ? AND pass = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(reviewId, pass) as Row | undefined;
    if (!row) return null;
    return {
      id: String(row.id), pass, questions: parseJson(row.questions_json, []), answers: parseJson(row.answers_json, {}),
      grading: parseJson(row.grading_json, null), score: row.score == null ? null : Number(row.score),
      generationProvenance: parseJson<AiProvenance | null>(row.generation_provenance_json, null),
      gradingProvenance: parseJson<AiProvenance | null>(row.grading_provenance_json, null),
      createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
    };
  }

  private getLatestEvaluation(reviewId: string, kind: 'summary' | 'critical-review', submission: string): WritingEvaluation | null {
    const row = this.db.prepare(`SELECT * FROM writing_evaluations WHERE review_id = ? AND kind = ? AND submission = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(reviewId, kind, submission) as Row | undefined;
    if (!row) return null;
    const value = parseJson<Omit<WritingEvaluation, 'id' | 'kind' | 'createdAt'>>(row.evaluation_json, {
      score: Number(row.score), overview: '', rubric: [], strengths: [], improvements: [], evidence: [],
    });
    return {
      id: String(row.id), kind, ...value, score: Number(row.score), createdAt: String(row.created_at),
      provenance: parseJson<AiProvenance | null>(row.provenance_json, null),
    };
  }

  getReview(id: string): Review {
    const row = this.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error('Review not found.');
    const progressRows = this.db.prepare('SELECT * FROM pass_progress WHERE review_id = ? ORDER BY pass').all(id) as Row[];
    const quizScores: Array<number | null> = [];
    const passes = progressRows.map((progress) => {
      const pass = Number(progress.pass) as PassNumber;
      const attempt = this.getLatestQuiz(id, pass);
      quizScores[pass - 1] = attempt?.score ?? null;
      return {
        pass, status: String(progress.status) as Review['passes'][number]['status'], notes: parseJson(progress.notes_json, {}),
        startedAt: progress.started_at ? String(progress.started_at) : null,
        completedAt: progress.completed_at ? String(progress.completed_at) : null, attempt,
      };
    });
    const summaryEvaluation = this.getLatestEvaluation(id, 'summary', String(row.summary));
    const criticalEvaluation = this.getLatestEvaluation(id, 'critical-review', String(row.critical_review));
    return {
      id: String(row.id), name: String(row.name), paperId: String(row.paper_id), projectId: row.project_id ? String(row.project_id) : null,
      status: String(row.status) as Review['status'], currentPass: Number(row.current_pass) as PassNumber,
      summary: String(row.summary), criticalReview: String(row.critical_review), createdAt: String(row.created_at),
      updatedAt: String(row.updated_at), completedAt: row.completed_at ? String(row.completed_at) : null,
      paper: this.getPaper(String(row.paper_id)), passes, summaryEvaluation, criticalEvaluation,
      score: calculateUnderstandingScore({ pass1: quizScores[0], pass2: quizScores[1], pass3: quizScores[2], summary: summaryEvaluation?.score, criticalReview: criticalEvaluation?.score }),
    };
  }

  private touchReview(id: string): void { this.db.prepare('UPDATE reviews SET updated_at = ? WHERE id = ?').run(now(), id); }

  listAnnotations(paperId: string, reviewId?: string): Annotation[] {
    const rows = (reviewId
      ? this.db.prepare('SELECT * FROM annotations WHERE paper_id = ? AND (review_id = ? OR review_id IS NULL) ORDER BY page, created_at').all(paperId, reviewId)
      : this.db.prepare('SELECT * FROM annotations WHERE paper_id = ? AND review_id IS NULL ORDER BY page, created_at').all(paperId)) as Row[];
    return rows.map((row) => ({
      id: String(row.id), paperId: String(row.paper_id), reviewId: row.review_id ? String(row.review_id) : null,
      page: Number(row.page), kind: String(row.kind) as AnnotationKind, content: String(row.content), quote: String(row.quote),
      color: String(row.color), rects: readHighlightRects(parseJson(row.rects_json, [])),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  saveAnnotation(input: AnnotationInput): Annotation {
    const paper = this.getPaper(input.paperId);
    if (!Number.isInteger(input.page) || input.page < 1) throw new Error('Annotation page must be a positive whole number.');
    if (input.page > paper.pageCount) throw new Error(`Page ${input.page} is outside this ${paper.pageCount}-page PDF.`);
    if (input.reviewId) {
      const review = this.getReview(input.reviewId);
      if (review.paperId !== input.paperId) throw new Error('This review does not belong to the selected paper.');
    }
    const id = input.id ?? crypto.randomUUID();
    const existing = this.db.prepare('SELECT paper_id, review_id FROM annotations WHERE id = ?').get(id) as Row | undefined;
    if (existing && (String(existing.paper_id) !== input.paperId || (existing.review_id ? String(existing.review_id) : null) !== input.reviewId)) {
      throw new Error('An annotation cannot be moved to another paper or review.');
    }
    const rects = input.rects ?? [];
    if (rects.length > MAX_HIGHLIGHT_RECTS || rects.some((rect) => !isValidHighlightRect(rect))) {
      throw new Error('Highlight position data is invalid.');
    }
    const timestamp = now();
    this.db.prepare(`INSERT INTO annotations(id, paper_id, review_id, page, kind, content, quote, color, rects_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET page = excluded.page, kind = excluded.kind, content = excluded.content,
      quote = excluded.quote, color = excluded.color, rects_json = excluded.rects_json, updated_at = excluded.updated_at`)
      .run(id, input.paperId, input.reviewId, input.page, input.kind, input.content.trim(), input.quote.trim(), input.color,
        JSON.stringify(rects), timestamp, timestamp);
    const row = this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Row;
    return {
      id: String(row.id), paperId: String(row.paper_id), reviewId: row.review_id ? String(row.review_id) : null,
      page: Number(row.page), kind: String(row.kind) as AnnotationKind, content: String(row.content), quote: String(row.quote),
      color: String(row.color), rects: readHighlightRects(parseJson(row.rects_json, [])),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  deleteAnnotation(id: string): void {
    const result = this.db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error('Annotation not found.');
  }

  async backup(destination: string): Promise<void> {
    this.db.pragma('wal_checkpoint(PASSIVE)');
    await this.db.backup(destination);
  }
}
