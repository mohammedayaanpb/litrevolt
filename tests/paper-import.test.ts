import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LitRevoltDatabase } from '../src/main/database/database';
import { PdfService } from '../src/main/papers/pdf-service';
import { StorageManager } from '../src/main/settings/storage';
import { AI_PAPER_FIXTURE, makeAiPaperPdf } from './fixtures/ai-paper';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('academic PDF import', () => {
  it('extracts page-aware text and creates a managed local copy', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-pdf-test-'));
    temporaryDirectories.push(temporaryRoot);
    const storage = new StorageManager(path.join(temporaryRoot, 'bootstrap'));
    storage.initialize(path.join(temporaryRoot, 'data'));
    const database = new LitRevoltDatabase(storage.databasePath);
    try {
      for (const name of ['DOMMatrix', 'DOMPoint', 'DOMRect', 'ImageData', 'Path2D']) {
        Reflect.deleteProperty(globalThis, name);
      }
      const service = new PdfService(database, storage);
      const source = path.join(temporaryRoot, `${AI_PAPER_FIXTURE.title}.pdf`);
      fs.writeFileSync(source, makeAiPaperPdf());
      const imported = await service.importFile(source);
      const record = database.getPaperSource(imported.paper.id);

      expect(imported.duplicate).toBe(false);
      expect(imported.paper.pageCount).toBeGreaterThan(1);
      expect(imported.paper.searchable).toBe(true);
      expect(globalThis.DOMMatrix).toBeDefined();
      expect(imported.paper.title).toBe(AI_PAPER_FIXTURE.title);
      expect(record.extractedText).toContain('[Page 1]');
      expect(record.extractedText).toContain(`[Page ${imported.paper.pageCount}]`);
      expect(fs.existsSync(record.managedPath)).toBe(true);

      const duplicate = await service.importFile(source);
      expect(duplicate.duplicate).toBe(true);
      expect(database.getLibrary().papers).toHaveLength(1);

      const reviewId = database.startReview(imported.paper.id);
      const attemptId = database.saveQuiz(reviewId, 1, [{ id: 'closed-book-q1', prompt: 'What is the paper about?' }]);
      expect(database.getPaper(imported.paper.id).activeQuizReviewId).toBe(reviewId);
      expect(() => service.readPdf(imported.paper.id)).toThrow(/hidden.*quiz/i);

      database.gradeQuiz(attemptId, { 'closed-book-q1': 'A method for reading papers.' }, {
        totalScore: 100, overview: '', strengths: [], gaps: [], questionGrades: [],
      }, 100);
      expect(database.getPaper(imported.paper.id).activeQuizReviewId).toBeNull();
      expect(service.readPdf(imported.paper.id).byteLength).toBe(fs.readFileSync(source).byteLength);
    } finally {
      database.close();
    }
  });
});
