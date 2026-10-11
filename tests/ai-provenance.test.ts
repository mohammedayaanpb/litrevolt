import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiProvenance, PassNumber, QuizGrading, QuizQuestion } from '../src/shared/types';
import { LitRevoltDatabase } from '../src/main/database/database';
import { ReviewService } from '../src/main/reviews/review-service';

const databases: LitRevoltDatabase[] = [];
const directories: string[] = [];

function temporaryPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-ai-provenance-'));
  directories.push(directory);
  return path.join(directory, 'litrevolt.db');
}

function openDatabase(filePath: string): LitRevoltDatabase {
  const database = new LitRevoltDatabase(filePath);
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const questions: QuizQuestion[] = [
  { id: 'q1', type: 'short-answer', prompt: 'Explain the central evidence.', focus: 'Evidence' },
];
const grading: QuizGrading = {
  totalScore: 80, overview: 'Grounded answer.', strengths: ['Accurate framing.'], gaps: ['Discuss uncertainty.'],
  questionGrades: [{ questionId: 'q1', score: 80, maxScore: 100, verdict: 'partial', feedback: 'Expand the evidence.', evidence: [{ page: 1, quote: 'The measured evidence supports the revised model.' }] }],
};
const writing = {
  score: 90, overview: 'Grounded summary.', rubric: [{ criterion: 'Fidelity', score: 90, maxScore: 100, feedback: 'Accurate.' }],
  strengths: ['Accurate evidence.'], improvements: ['Discuss limitations.'], evidence: [{ page: 1, quote: 'The measured evidence supports the revised model.' }],
};

describe('AI result provenance', () => {
  it('migrates historical results without guessing their model or changing saved work and is idempotent', () => {
    const filePath = temporaryPath();
    const legacy = new Database(filePath);
    try {
      legacy.exec(fs.readFileSync(new URL('../drizzle/0001_initial.sql', import.meta.url), 'utf8'));
      legacy.prepare(`INSERT INTO papers
        (id, title, original_name, managed_path, file_hash, page_count, searchable, extracted_text, created_at, updated_at)
        VALUES ('paper', 'Legacy paper', 'paper.pdf', 'paper.pdf', 'hash', 1, 1, 'Saved source text', '2026-01-01', '2026-01-01')`).run();
      legacy.prepare(`INSERT INTO reviews
        (id, paper_id, status, current_pass, summary, critical_review, created_at, updated_at)
        VALUES ('review', 'paper', 'in-progress', 1, 'Saved summary', 'Saved critique', '2026-01-01', '2026-01-03')`).run();
      legacy.prepare(`INSERT INTO pass_progress(review_id, pass, status, notes_json)
        VALUES ('review', 1, 'in-progress', '{"category":"Saved notes"}')`).run();
      legacy.prepare(`INSERT INTO quiz_attempts
        (id, review_id, pass, questions_json, answers_json, grading_json, score, created_at, completed_at)
        VALUES ('quiz', 'review', 1, ?, ?, ?, 80, '2026-01-02', '2026-01-03')`)
        .run(JSON.stringify(questions), JSON.stringify({ q1: 'Saved answer' }), JSON.stringify(grading));
      legacy.prepare(`INSERT INTO writing_evaluations
        (id, review_id, kind, submission, evaluation_json, score, created_at)
        VALUES ('writing', 'review', 'summary', 'Saved summary', ?, 90, '2026-01-03')`).run(JSON.stringify(writing));
      legacy.prepare("INSERT INTO app_settings(key, value) VALUES ('model', 'current-model-unrelated-to-history')").run();
    } finally { legacy.close(); }

    let database = openDatabase(filePath);
    const migrated = database.getReview('review');
    expect(migrated).toMatchObject({ summary: 'Saved summary', criticalReview: 'Saved critique', createdAt: '2026-01-01', updatedAt: '2026-01-03' });
    expect(migrated.passes[0].notes).toEqual({ category: 'Saved notes' });
    expect(migrated.passes[0].attempt).toMatchObject({
      questions, answers: { q1: 'Saved answer' }, grading, score: 80,
      createdAt: '2026-01-02', completedAt: '2026-01-03', generationProvenance: null, gradingProvenance: null,
    });
    expect(migrated.summaryEvaluation).toMatchObject({ ...writing, provenance: null, createdAt: '2026-01-03' });
    database.close();
    database = openDatabase(filePath);
    expect(database.getReview('review')).toEqual(migrated);
    expect(database.getSetting('model')).toBe('current-model-unrelated-to-history');

    const raw = new Database(filePath, { readonly: true });
    try {
      expect(raw.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 4').get()).toEqual({ count: 1 });
      const columns = raw.prepare('PRAGMA table_info(quiz_attempts)').all() as { name: string }[];
      expect(columns.filter((column) => column.name === 'generation_provenance_json')).toHaveLength(1);
      expect(columns.filter((column) => column.name === 'grading_provenance_json')).toHaveLength(1);
      expect(raw.prepare('SELECT generation_provenance_json, grading_provenance_json FROM quiz_attempts').get())
        .toEqual({ generation_provenance_json: null, grading_provenance_json: null });
      expect(raw.prepare('SELECT provenance_json FROM writing_evaluations').get()).toEqual({ provenance_json: null });
    } finally { raw.close(); }
  });

  it('stores generation, grading, and writing identities from each operation across provider changes and restart', async () => {
    const filePath = temporaryPath();
    let database = openDatabase(filePath);
    const paper = database.insertPaper({
      id: 'paper', title: 'Research paper', authors: '', year: '', abstract: '', originalName: 'paper.pdf',
      managedPath: path.join(path.dirname(filePath), 'paper.pdf'), fileHash: 'hash',
      pageCount: 1, searchable: true, extractedText: '[Page 1]\nThe measured evidence supports the revised model.',
    });
    const generationProvenance: AiProvenance = { provider: 'anthropic', model: 'claude-generated-model', documentMode: 'pdf' };
    const gradingProvenance: AiProvenance = { provider: 'openai', model: 'openai-graded-model', documentMode: 'pdf' };
    const writingProvenance: AiProvenance = { provider: 'kimi', model: 'kimi-writing-model', documentMode: 'page-images' };
    const ai = {
      generateQuiz: vi.fn().mockResolvedValue({ value: questions, provenance: generationProvenance }),
      gradeQuiz: vi.fn().mockResolvedValue({ value: grading, provenance: gradingProvenance }),
      evaluateWriting: vi.fn().mockResolvedValue({ value: writing, provenance: writingProvenance }),
    };
    const service = new ReviewService(database, ai as never);
    const reviewId = service.start(paper.id).id;
    for (const pass of [1, 2, 3] as PassNumber[]) {
      const generated = await service.generateQuiz(reviewId, pass);
      expect(generated.passes[pass - 1].attempt).toMatchObject({ generationProvenance, gradingProvenance: null });
      await service.submitQuiz(reviewId, pass, { q1: 'A saved answer with supporting evidence.' });
      service.completePass(reviewId, pass);
    }
    const submission = 'The paper compares its claims with measured evidence, explaining its method and conclusions while acknowledging the limits of its observations.';
    service.saveWriting(reviewId, 'summary', submission);
    await service.evaluateWriting(reviewId, 'summary');
    database.setSetting('model', 'later-settings-must-not-overwrite-result-provenance');
    const saved = database.getReview(reviewId);
    expect(saved.passes[0].attempt).toMatchObject({ generationProvenance, gradingProvenance, grading, score: 80 });
    expect(saved.summaryEvaluation).toMatchObject({ ...writing, provenance: writingProvenance });
    database.close();
    database = openDatabase(filePath);
    expect(database.getReview(reviewId)).toEqual(saved);
    expect(ai.evaluateWriting).toHaveBeenCalledWith(expect.any(Object), 'summary', submission);
  });
});
