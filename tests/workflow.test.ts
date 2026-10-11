import { describe, expect, it } from 'vitest';
import { calculateUnderstandingScore, SCORE_WEIGHTS } from '../src/shared/workflow';

describe('understanding score', () => {
  it('uses progressively deeper pass weights and two writing weights', () => {
    expect(SCORE_WEIGHTS).toEqual({ pass1: 15, pass2: 20, pass3: 25, summary: 20, criticalReview: 20 });
    const score = calculateUnderstandingScore({ pass1: 80, pass2: 70, pass3: 90, summary: 75, criticalReview: 85 });
    expect(score).toEqual({
      pass1: 12,
      pass2: 14,
      pass3: 22.5,
      summary: 15,
      criticalReview: 17,
      total: 80.5,
      complete: true,
    });
  });

  it('does not pretend missing evidence is a completed score', () => {
    const score = calculateUnderstandingScore({ pass1: 100, pass2: null });
    expect(score.total).toBe(15);
    expect(score.complete).toBe(false);
  });

  it('clamps corrupt or non-finite component scores', () => {
    const score = calculateUnderstandingScore({ pass1: 140, pass2: -20, pass3: Number.NaN });
    expect(score.pass1).toBe(15);
    expect(score.pass2).toBe(0);
    expect(score.pass3).toBe(0);
    expect(score.total).toBe(15);
  });
});
