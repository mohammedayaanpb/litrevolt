import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LitRevoltDatabase } from '../src/main/database/database';
import { registerIpc } from '../src/main/ipc/register-ipc';

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  app: {}, dialog: {}, shell: {},
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcHandlers.set(channel, handler) },
}));

const databases: LitRevoltDatabase[] = [];
const directories: string[] = [];
function temporaryPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-review-management-'));
  directories.push(directory);
  return path.join(directory, 'litrevolt.db');
}
function openDatabase(filePath = temporaryPath()) {
  const database = new LitRevoltDatabase(filePath);
  databases.push(database);
  return database;
}
function addPaper(database: LitRevoltDatabase, title = 'Research paper', projectId?: string) {
  const id = crypto.randomUUID();
  return database.insertPaper({
    id, title, authors: 'Researcher', year: '2026', abstract: 'Abstract', originalName: `${id}.pdf`,
    managedPath: path.join(path.dirname(database.filePath), `${id}.pdf`), fileHash: id,
    pageCount: 2, searchable: true, extractedText: '[Page 1]\nResearch evidence',
  }, projectId);
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  ipcHandlers.clear();
});

describe('review names and migration', () => {
  it('migrates legacy reviews chronologically per paper, preserves work, and is idempotent across restarts', () => {
    const filePath = temporaryPath();
    const firstPaper = crypto.randomUUID();
    const secondPaper = crypto.randomUUID();
    const earlier = crypto.randomUUID();
    const later = crypto.randomUUID();
    const separate = crypto.randomUUID();
    const legacy = new Database(filePath);
    try {
      legacy.exec(fs.readFileSync(new URL('../drizzle/0001_initial.sql', import.meta.url), 'utf8'));
      const insertPaper = legacy.prepare(`INSERT INTO papers
        (id, title, original_name, managed_path, file_hash, page_count, searchable, extracted_text, created_at, updated_at)
        VALUES (?, 'Legacy paper', 'legacy.pdf', ?, ?, 2, 1, 'Saved paper text', '2026-01-01', '2026-01-01')`);
      for (const id of [firstPaper, secondPaper]) insertPaper.run(id, `${id}.pdf`, id);
      const insertReview = legacy.prepare(`INSERT INTO reviews
        (id, paper_id, status, current_pass, summary, created_at, updated_at)
        VALUES (?, ?, 'in-progress', 1, 'Saved writing', ?, ?)`);
      // Insertion order deliberately differs from creation order.
      insertReview.run(later, firstPaper, '2026-01-03', '2026-01-03');
      insertReview.run(earlier, firstPaper, '2026-01-02', '2026-02-01');
      insertReview.run(separate, secondPaper, '2026-01-04', '2026-01-04');
      legacy.prepare(`INSERT INTO pass_progress(review_id, pass, status, notes_json)
        VALUES (?, 1, 'in-progress', '{"category":"Saved pass note"}')`).run(earlier);
      legacy.prepare(`INSERT INTO annotations(id, paper_id, review_id, page, kind, content, color, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'note', 'Saved annotation', '#D65D3B', '2026-01-02', '2026-01-02')`)
        .run(crypto.randomUUID(), firstPaper, earlier);
    } finally { legacy.close(); }

    let database = openDatabase(filePath);
    expect(database.getReview(earlier)).toMatchObject({ name: 'Review 1', summary: 'Saved writing', createdAt: '2026-01-02', updatedAt: '2026-02-01' });
    expect(database.getReview(earlier).passes[0].notes).toEqual({ category: 'Saved pass note' });
    expect(database.listAnnotations(firstPaper, earlier)[0].content).toBe('Saved annotation');
    expect(database.getReview(later).name).toBe('Review 2');
    expect(database.getReview(separate).name).toBe('Review 1');
    database.renameReview(earlier, 'Original assumptions');
    const saved = database.getReview(earlier);
    database.close();

    database = openDatabase(filePath);
    expect(database.getReview(earlier)).toEqual(saved);
    expect(database.getReview(later).name).toBe('Review 2');
    expect(database.getReview(database.startReview(firstPaper)).name).toBe('Review 3');
    const raw = new Database(filePath, { readonly: true });
    try {
      expect(raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 3').get()).toEqual({ count: 1 });
      expect((raw.prepare('PRAGMA table_info(reviews)').all() as { name: string }[]).filter((column) => column.name === 'name')).toHaveLength(1);
    } finally { raw.close(); }
  });

  it('assigns readable defaults without colliding with retained review numbers after deletion', () => {
    const database = openDatabase();
    const paper = addPaper(database);
    const first = database.startReview(paper.id);
    const second = database.startReview(paper.id);
    expect(database.getReview(first).name).toBe('Review 1');
    expect(database.getReview(second).name).toBe('Review 2');
    database.deleteReview(first);
    expect(database.getReview(database.startReview(paper.id)).name).toBe('Review 3');
    database.renameReview(second, 'Review 10');
    expect(database.getReview(database.startReview(paper.id)).name).toBe('Review 11');
    expect(database.getReview(database.startReview(addPaper(database).id)).name).toBe('Review 1');
  });

  it('trims names, validates boundaries, and persists renames in every list and detail view', () => {
    let database = openDatabase();
    const paper = addPaper(database);
    const reviewId = database.startReview(paper.id);
    const before = database.getReview(reviewId);
    const renamed = database.renameReview(reviewId, '  Replication: α + β  ');
    expect(renamed.name).toBe('Replication: α + β');
    expect(database.getReview(reviewId)).toMatchObject({ name: renamed.name, createdAt: before.createdAt, passes: before.passes });
    expect(database.listReviews()[0]).toEqual(renamed);
    expect(database.listReviewsForPaper(paper.id)[0]).toEqual(renamed);
    expect(database.getLibrary().recentReviews[0]).toEqual(renamed);
    for (const invalid of ['', '  \n\t', 'x'.repeat(201), null, 123]) {
      expect(() => database.renameReview(reviewId, invalid as string)).toThrow(/Review name/);
    }
    expect(database.getReview(reviewId).name).toBe(renamed.name);
    const longest = 'x'.repeat(200);
    expect(database.renameReview(reviewId, ` ${longest} `).name).toBe(longest);
    const filePath = database.filePath;
    database.close();
    database = openDatabase(filePath);
    expect(database.getReview(reviewId).name).toBe(longest);
    expect(() => database.renameReview(crypto.randomUUID(), 'Missing review')).toThrow('Review not found.');
    expect(() => database.deleteReview(crypto.randomUUID())).toThrow('Review not found.');
  });
});

describe('reviews collection and safe deletion', () => {
  it('lists every review with its own project context while keeping only eight recents', () => {
    const database = openDatabase();
    const firstProject = database.createProject({ name: 'Robotics', description: '' });
    const secondProject = database.createProject({ name: 'Learning', description: '' });
    const paper = addPaper(database, 'Shared paper', firstProject.id);
    database.setPaperProjects(paper.id, [firstProject.id, secondProject.id]);
    const ids = Array.from({ length: 12 }, (_, index) => database.startReview(paper.id,
      index % 3 === 0 ? firstProject.id : index % 3 === 1 ? secondProject.id : undefined));
    const reviews = database.listReviews();
    expect(reviews.map((review) => review.id)).toEqual([...ids].reverse());
    expect(reviews.filter((review) => review.projectId === firstProject.id)).toHaveLength(4);
    expect(reviews.filter((review) => review.projectId === secondProject.id)).toHaveLength(4);
    expect(reviews.filter((review) => review.projectId === null)).toHaveLength(4);
    expect(reviews.find((review) => review.id === ids[0])).toMatchObject({ name: 'Review 1', paperId: paper.id,
      paperTitle: 'Shared paper', projectId: firstProject.id, projectName: 'Robotics', currentPass: 1, status: 'in-progress', score: 0 });
    expect(reviews.every((review) => review.createdAt && review.updatedAt)).toBe(true);
    expect(database.listReviewsForPaper(paper.id)).toEqual(reviews);
    expect(database.getLibrary().recentReviews).toEqual(reviews.slice(0, 8));
    // Review context does not change when the paper's memberships are edited.
    database.setPaperProjects(paper.id, []);
    expect(database.listReviews()).toEqual(reviews);
    database.updateProject(firstProject.id, { name: 'Robotics research', description: '' });
    expect(database.listReviews().find((review) => review.id === ids[0])?.projectName).toBe('Robotics research');
    database.deleteProject(firstProject.id);
    expect(database.listReviews().filter((review) => review.projectId === null)).toHaveLength(8);
    expect(database.listReviews().find((review) => review.id === ids[0])?.projectName).toBeNull();
  });

  it('keeps summary scores and pass state consistent with detail views, including changed writing', () => {
    const database = openDatabase();
    const paper = addPaper(database);
    const reviewId = database.startReview(paper.id);
    for (const pass of [1, 2, 3] as const) {
      const attempt = database.saveQuiz(reviewId, pass, []);
      database.gradeQuiz(attempt, {}, { totalScore: 80 }, 80);
      database.completePass(reviewId, pass);
    }
    for (const kind of ['summary', 'critical-review'] as const) {
      database.saveWriting(reviewId, kind, `Saved ${kind}`);
      database.saveWritingEvaluation(reviewId, kind, `Saved ${kind}`, { score: 90 }, 90);
    }
    expect(database.listReviews()[0]).toMatchObject({ score: database.getReview(reviewId).score.total, currentPass: 3, status: 'complete' });
    database.saveWriting(reviewId, 'summary', 'New unevaluated submission');
    expect(database.listReviews()[0]).toMatchObject({ score: database.getReview(reviewId).score.total, currentPass: 3, status: 'writing' });
    expect(database.listReviews()[0].score).toBe(66);
  });

  it('deletes only the selected review and its owned records, retaining the paper and other reviews', () => {
    const database = openDatabase();
    const project = database.createProject({ name: 'Keep project', description: '' });
    const paper = addPaper(database, 'Keep paper', project.id);
    const removed = database.startReview(paper.id, project.id);
    const retained = database.startReview(paper.id);
    const pdfPath = database.getPaperSource(paper.id).managedPath;
    fs.writeFileSync(pdfPath, '%PDF-kept');
    database.savePassNotes(removed, 1, { category: 'Removed notes' });
    database.savePassNotes(retained, 1, { category: 'Keep notes' });
    database.saveQuiz(removed, 1, []);
    const retainedAttempt = database.saveQuiz(retained, 1, []);
    database.gradeQuiz(retainedAttempt, {}, { totalScore: 70 }, 70);
    for (const id of [removed, retained]) {
      database.saveWriting(id, 'summary', 'Saved summary');
      database.saveWritingEvaluation(id, 'summary', 'Saved summary', { score: 80 }, 80);
    }
    const annotation = (reviewId: string | null) => database.saveAnnotation({ paperId: paper.id, reviewId,
      page: 1, kind: 'note', content: 'Keep unless review is deleted', quote: '', color: '#D65D3B' });
    const globalNote = annotation(null);
    annotation(removed);
    const retainedNote = annotation(retained);
    expect(database.getPaper(paper.id).activeQuizReviewId).toBe(removed);

    database.deleteReview(removed);
    expect(() => database.getReview(removed)).toThrow('Review not found.');
    expect(database.getPaper(paper.id)).toMatchObject({ title: 'Keep paper', projectIds: [project.id], reviewCount: 1, activeQuizReviewId: null });
    expect(database.getReview(retained).passes[0].notes).toEqual({ category: 'Keep notes' });
    expect(database.getReview(retained).summaryEvaluation?.score).toBe(80);
    expect(database.listReviews().map((review) => review.id)).toEqual([retained]);
    expect(database.listReviewsForPaper(paper.id).map((review) => review.id)).toEqual([retained]);
    expect(database.getLibrary().recentReviews.map((review) => review.id)).toEqual([retained]);
    expect(database.listAnnotations(paper.id)).toEqual([globalNote]);
    expect(database.listAnnotations(paper.id, retained)).toEqual([globalNote, retainedNote]);
    expect(fs.readFileSync(pdfPath, 'utf8')).toBe('%PDF-kept');
    const raw = new Database(database.filePath, { readonly: true });
    try {
      for (const table of ['pass_progress', 'quiz_attempts', 'writing_evaluations', 'annotations']) {
        expect(raw.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE review_id = ?`).get(removed)).toEqual({ count: 0 });
        expect((raw.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE review_id = ?`).get(retained) as { count: number }).count).toBeGreaterThan(0);
      }
      expect(raw.pragma('foreign_key_check')).toEqual([]);
    } finally { raw.close(); }
  });
});

describe('review management IPC boundary', () => {
  it('registers collection, rename and delete handlers with identifier and name validation', () => {
    const database = openDatabase();
    const paper = addPaper(database);
    const reviewId = database.startReview(paper.id);
    registerIpc({ requireDatabase: () => database } as never);
    const rename = ipcHandlers.get('reviews:rename')!;
    const remove = ipcHandlers.get('reviews:delete')!;
    expect(ipcHandlers.get('reviews:list')!()).toEqual(database.listReviews());
    expect(rename(null, reviewId, '  Named through IPC  ')).toMatchObject({ id: reviewId, name: 'Named through IPC' });
    for (const invalid of ['', '   ', 'x'.repeat(201), null, 123]) expect(() => rename(null, reviewId, invalid)).toThrow();
    expect(() => rename(null, 'invalid-id', 'Valid name')).toThrow();
    expect(() => remove(null, 'invalid-id')).toThrow();
    expect(database.getReview(reviewId).name).toBe('Named through IPC');
    remove(null, reviewId);
    expect(ipcHandlers.get('reviews:list')!()).toEqual([]);
  });
});
