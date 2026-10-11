import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { LitRevoltDatabase } from '../src/main/database/database';

const temporaryDirectories: string[] = [];
const createDatabase = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-test-'));
  temporaryDirectories.push(directory);
  return { database: new LitRevoltDatabase(path.join(directory, 'litrevolt.db')), directory };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('local review persistence', () => {
  it('enforces sequential passes and produces a complete evidence score', () => {
    const { database, directory } = createDatabase();
    const managedPath = path.join(directory, 'paper.pdf');
    fs.writeFileSync(managedPath, '%PDF-test');
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'A careful paper', authors: 'Researcher', year: '2026', abstract: 'Abstract',
      originalName: 'paper.pdf', managedPath, fileHash: 'hash-1', pageCount: 8, searchable: true,
      extractedText: '[Page 1]\nA careful paper',
    });
    const reviewId = database.startReview(paper.id);

    expect(() => database.completePass(reviewId, 1)).toThrow(/quiz/i);
    for (const pass of [1, 2, 3] as const) {
      const attemptId = database.saveQuiz(reviewId, pass, [{ id: `p${pass}-q1`, prompt: 'Question' }]);
      database.gradeQuiz(attemptId, { [`p${pass}-q1`]: 'Answer' }, {
        totalScore: pass === 1 ? 80 : pass === 2 ? 70 : 90,
        overview: '', strengths: [], gaps: [], questionGrades: [],
      }, pass === 1 ? 80 : pass === 2 ? 70 : 90);
      database.completePass(reviewId, pass);
    }

    database.saveWriting(reviewId, 'summary', 'My summary');
    database.saveWritingEvaluation(reviewId, 'summary', 'My summary', {
      score: 75, overview: '', rubric: [], strengths: [], improvements: [], evidence: [],
    }, 75);
    database.saveWriting(reviewId, 'critical-review', 'My critique');
    database.saveWritingEvaluation(reviewId, 'critical-review', 'My critique', {
      score: 85, overview: '', rubric: [], strengths: [], improvements: [], evidence: [],
    }, 85);

    const review = database.getReview(reviewId);
    expect(review.passes.map((pass) => pass.status)).toEqual(['complete', 'complete', 'complete']);
    expect(review.status).toBe('complete');
    expect(review.score.total).toBe(80.5);
    expect(review.score.complete).toBe(true);
    database.close();
  });

  it('keeps project organization and annotations in SQLite', () => {
    const { database, directory } = createDatabase();
    const project = database.createProject({ name: 'Robotics', description: 'Planning and control' });
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'Robot paper', authors: '', year: '', abstract: '', originalName: 'robot.pdf',
      managedPath: path.join(directory, 'robot.pdf'), fileHash: 'hash-2', pageCount: 2, searchable: false, extractedText: '',
    }, project.id);
    const annotation = database.saveAnnotation({
      paperId: paper.id, reviewId: null, page: 2, kind: 'highlight', content: 'Important assumption', quote: 'Assume perfect sensing', color: '#F2C14E',
    });
    expect(database.getLibrary().projects[0].paperCount).toBe(1);
    expect(database.listAnnotations(paper.id)).toEqual([annotation]);
    database.close();
  });

  it('persists independent project assignments without metadata edits overwriting them', () => {
    const { database, directory } = createDatabase();
    let savedPaperId = '';
    let retainedProjectId = '';
    try {
      const first = database.createProject({ name: 'Robotics', description: '' });
      const second = database.createProject({ name: 'Learning', description: '' });
      const paper = database.insertPaper({
        id: crypto.randomUUID(), title: 'Project membership', authors: '', year: '', abstract: '', originalName: 'projects.pdf',
        managedPath: path.join(directory, 'projects.pdf'), fileHash: 'hash-project-membership', pageCount: 1, searchable: true,
        extractedText: '[Page 1]\nPaper text',
      });
      savedPaperId = paper.id;
      retainedProjectId = second.id;

      database.setPaperProjects(paper.id, [first.id, second.id, first.id]);
      expect(new Set(database.getPaper(paper.id).projectIds)).toEqual(new Set([first.id, second.id]));
      expect(database.getProject(first.id).paperCount).toBe(1);
      expect(database.getProject(second.id).paperCount).toBe(1);

      database.setPaperProjects(paper.id, [second.id]);
      database.updatePaper(paper.id, { title: 'Updated metadata' });
      expect(database.getPaper(paper.id).projectIds).toEqual([second.id]);
      expect(database.getProject(first.id).paperCount).toBe(0);
      expect(database.getProject(second.id).paperCount).toBe(1);
    } finally { database.close(); }

    const reopened = new LitRevoltDatabase(path.join(directory, 'litrevolt.db'));
    try {
      expect(reopened.getPaper(savedPaperId).title).toBe('Updated metadata');
      expect(reopened.getPaper(savedPaperId).projectIds).toEqual([retainedProjectId]);
      reopened.setPaperProjects(savedPaperId, []);
      expect(reopened.getPaper(savedPaperId).projectIds).toEqual([]);
      expect(reopened.getProject(retainedProjectId).paperCount).toBe(0);
    } finally { reopened.close(); }
  });

  it('retains existing project membership if an independent assignment fails', () => {
    const { database, directory } = createDatabase();
    try {
      const original = database.createProject({ name: 'Original project', description: '' });
      const replacement = database.createProject({ name: 'Replacement project', description: '' });
      const paper = database.insertPaper({
        id: crypto.randomUUID(), title: 'Atomic membership', authors: '', year: '', abstract: '', originalName: 'membership.pdf',
        managedPath: path.join(directory, 'membership.pdf'), fileHash: 'hash-atomic-membership', pageCount: 1, searchable: true,
        extractedText: '[Page 1]\nPaper text',
      }, original.id);

      expect(() => database.setPaperProjects(paper.id, [replacement.id, crypto.randomUUID()])).toThrow();
      expect(database.getPaper(paper.id).projectIds).toEqual([original.id]);
      expect(database.getProject(original.id).paperCount).toBe(1);
      expect(database.getProject(replacement.id).paperCount).toBe(0);

      database.setPaperProjects(paper.id, [replacement.id]);
      expect(database.getPaper(paper.id).projectIds).toEqual([replacement.id]);
      expect(database.getProject(original.id).paperCount).toBe(0);
      expect(database.getProject(replacement.id).paperCount).toBe(1);
    } finally { database.close(); }
  });

  it('scores only evaluations of the current writing while preserving evaluation history', () => {
    const { database, directory } = createDatabase();
    try {
      const paper = database.insertPaper({
        id: crypto.randomUUID(), title: 'Writing versions', authors: '', year: '', abstract: '', originalName: 'versions.pdf',
        managedPath: path.join(directory, 'versions.pdf'), fileHash: 'hash-versions', pageCount: 1, searchable: true,
        extractedText: '[Page 1]\nPaper text',
      });
      const reviewId = database.startReview(paper.id);
      for (const pass of [1, 2, 3] as const) {
        const attemptId = database.saveQuiz(reviewId, pass, [{ id: `p${pass}-q1`, prompt: 'Question' }]);
        database.gradeQuiz(attemptId, { [`p${pass}-q1`]: 'Answer' }, { totalScore: 80 }, 80);
        database.completePass(reviewId, pass);
      }
      for (const kind of ['summary', 'critical-review'] as const) {
        database.saveWriting(reviewId, kind, `Original ${kind}`);
        database.saveWritingEvaluation(reviewId, kind, `Original ${kind}`, { score: 90 }, 90);
      }
      expect(database.getReview(reviewId).status).toBe('complete');

      database.saveWriting(reviewId, 'summary', 'Changed summary');
      let review = database.getReview(reviewId);
      expect(review.summaryEvaluation).toBeNull();
      expect(review.criticalEvaluation?.score).toBe(90);
      expect(review.score.summary).toBe(0);
      expect(review.score.complete).toBe(false);
      expect(review.status).toBe('writing');
      expect(review.completedAt).toBeNull();

      // A late evaluation for an old submission must not grade the new draft.
      database.saveWritingEvaluation(reviewId, 'summary', 'Original summary', { score: 99 }, 99);
      expect(database.getReview(reviewId).score.complete).toBe(false);
      database.saveWritingEvaluation(reviewId, 'summary', 'Changed summary', { score: 75 }, 75);
      expect(database.getReview(reviewId).status).toBe('complete');

      // Reverting to an already evaluated exact version can use its stored evidence.
      database.saveWriting(reviewId, 'summary', 'Original summary');
      review = database.getReview(reviewId);
      expect(review.summaryEvaluation?.score).toBe(99);
      expect(review.score.complete).toBe(true);
      expect(review.status).toBe('complete');
      database.saveWriting(reviewId, 'critical-review', 'Changed critical review');
      expect(database.getReview(reviewId).criticalEvaluation).toBeNull();
      expect(database.getReview(reviewId).status).toBe('writing');

      const raw = new Database(path.join(directory, 'litrevolt.db'), { readonly: true });
      try { expect(raw.prepare('SELECT COUNT(*) AS count FROM writing_evaluations').get()).toEqual({ count: 4 }); }
      finally { raw.close(); }
    } finally { database.close(); }
  });

  it('isolates global annotations from review-specific annotations', () => {
    const { database, directory } = createDatabase();
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'Isolation paper', authors: '', year: '', abstract: '', originalName: 'isolation.pdf',
      managedPath: path.join(directory, 'isolation.pdf'), fileHash: 'hash-3', pageCount: 3, searchable: true, extractedText: '[Page 1]\nText',
    });
    const reviewId = database.startReview(paper.id);
    const globalNote = database.saveAnnotation({ paperId: paper.id, reviewId: null, page: 1, kind: 'note', content: 'Global', quote: '', color: '#D65D3B' });
    const reviewNote = database.saveAnnotation({ paperId: paper.id, reviewId, page: 2, kind: 'note', content: 'Review', quote: '', color: '#D65D3B' });

    expect(database.listAnnotations(paper.id)).toEqual([globalNote]);
    expect(database.listAnnotations(paper.id, reviewId)).toEqual([globalNote, reviewNote]);
    expect(() => database.saveAnnotation({ ...reviewNote, paperId: crypto.randomUUID() })).toThrow(/cannot be moved|not found/i);
    expect(() => database.saveAnnotation({ paperId: paper.id, reviewId: null, page: 4, kind: 'note', content: '', quote: '', color: '#D65D3B' })).toThrow(/outside/i);
    database.close();
  });

  it('rejects blank paper titles and unassigned project review contexts', () => {
    const { database, directory } = createDatabase();
    const project = database.createProject({ name: 'Unassigned', description: '' });
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'Valid title', authors: '', year: '', abstract: '', originalName: 'valid.pdf',
      managedPath: path.join(directory, 'valid.pdf'), fileHash: 'hash-4', pageCount: 1, searchable: true, extractedText: '[Page 1]\nText',
    });
    expect(() => database.updatePaper(paper.id, { title: '   ' })).toThrow(/title is required/i);
    expect(() => database.startReview(paper.id, project.id)).toThrow(/assign this paper/i);
    database.close();
  });

  it('rolls back paper metadata when a project assignment is invalid', () => {
    const { database, directory } = createDatabase();
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'Original title', authors: '', year: '', abstract: '', originalName: 'atomic.pdf',
      managedPath: path.join(directory, 'atomic.pdf'), fileHash: 'hash-5', pageCount: 1, searchable: true, extractedText: '[Page 1]\nText',
    });

    expect(() => database.updatePaper(paper.id, { title: 'Partially saved title', projectIds: [crypto.randomUUID()] })).toThrow();
    expect(database.getPaper(paper.id).title).toBe('Original title');
    expect(database.getPaper(paper.id).projectIds).toEqual([]);
    database.close();
  });

  it('keeps full paper review history while limiting the library recents list', () => {
    const { database, directory } = createDatabase();
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'History paper', authors: '', year: '', abstract: '', originalName: 'history.pdf',
      managedPath: path.join(directory, 'history.pdf'), fileHash: 'hash-6', pageCount: 1, searchable: true, extractedText: '[Page 1]\nText',
    });
    for (let index = 0; index < 9; index += 1) database.startReview(paper.id);

    expect(database.getLibrary().recentReviews).toHaveLength(8);
    expect(database.listReviewsForPaper(paper.id)).toHaveLength(9);
    database.close();
  });

  it('migrates legacy annotations and persists zoom-independent highlight rectangles', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-highlight-migration-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'litrevolt.db');
    const legacy = new Database(filePath);
    legacy.exec(`CREATE TABLE annotations (
      id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, review_id TEXT, page INTEGER NOT NULL, kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '', color TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    legacy.close();

    let database = new LitRevoltDatabase(filePath);
    const paper = database.insertPaper({
      id: crypto.randomUUID(), title: 'Selectable paper', authors: '', year: '', abstract: '', originalName: 'selectable.pdf',
      managedPath: path.join(directory, 'selectable.pdf'), fileHash: 'hash-highlight', pageCount: 2, searchable: true,
      extractedText: '[Page 1]\nSelectable text',
    });
    const highlight = database.saveAnnotation({
      paperId: paper.id, reviewId: null, page: 1, kind: 'highlight', content: '', quote: 'Selectable text', color: '#F2C14E',
      rects: [{ x: 0.125, y: 0.25, width: 0.5, height: 0.03 }],
    });
    expect(highlight.rects).toEqual([{ x: 0.125, y: 0.25, width: 0.5, height: 0.03 }]);
    expect(() => database.saveAnnotation({
      paperId: paper.id, reviewId: null, page: 1, kind: 'highlight', content: '', quote: 'Outside', color: '#F2C14E',
      rects: [{ x: 0.9, y: 0.25, width: 0.2, height: 0.03 }],
    })).toThrow(/position data is invalid/i);
    database.close();

    database = new LitRevoltDatabase(filePath);
    expect(database.listAnnotations(paper.id)).toEqual([highlight]);
    database.close();
  });
});
