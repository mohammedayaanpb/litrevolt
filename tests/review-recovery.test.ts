import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LitRevoltDatabase } from '../src/main/database/database';
import { ReviewService } from '../src/main/reviews/review-service';

describe('quiz submission recovery', () => {
  it('persists submitted answers across restart after an API failure without unlocking the paper', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-recovery-'));
    const databasePath = path.join(directory, 'litrevolt.db');
    let database = new LitRevoltDatabase(databasePath);
    try {
      const paper = database.insertPaper({
        id: crypto.randomUUID(), title: 'Recovery test', authors: '', year: '', abstract: '',
        originalName: 'paper.pdf', managedPath: path.join(directory, 'paper.pdf'), fileHash: 'recovery',
        pageCount: 1, searchable: true, extractedText: '[Page 1]\nThe measured evidence supports the revised model.',
      });
      const reviewId = database.startReview(paper.id);
      const attemptId = database.saveQuiz(reviewId, 1, [
        { id: 'q1', type: 'short-answer', prompt: 'Explain the main finding.', focus: 'Understanding' },
      ]);
      const claude = { gradeQuiz: vi.fn().mockRejectedValue(new Error('Simulated API failure')) };
      const service = new ReviewService(database, claude as never);
      await expect(service.submitQuiz(reviewId, 1, { q1: ' The revised model separates the two coefficients. ' })).rejects.toThrow('Simulated API failure');
      database.close();
      database = new LitRevoltDatabase(databasePath);
      const recovered = database.getReview(reviewId);
      expect(recovered.passes[0].attempt?.answers).toEqual({ q1: 'The revised model separates the two coefficients.' });
      expect(recovered.passes[0].attempt?.grading).toBeNull();
      expect(recovered.passes[1].status).toBe('locked');
      expect(database.getPaper(paper.id).activeQuizReviewId).toBe(reviewId);
      database.gradeQuiz(attemptId, { q1: 'Final answer' }, { totalScore: 80 }, 80);
      expect(() => database.saveQuizAnswers(attemptId, { q1: 'Overwritten answer' })).toThrow('already been submitted');
      expect(database.getReview(reviewId).passes[0].attempt?.answers).toEqual({ q1: 'Final answer' });
    } finally {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
