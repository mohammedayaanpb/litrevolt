import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiEvaluationService } from '../src/main/ai/ai-evaluation-service';
import { AI_PROVIDERS } from '../src/shared/config';

const criticalCriteria = [
  'Accurate framing',
  'Depth of methodological critique',
  'Analysis of assumptions and evidence',
  'Limitations and alternative explanations',
  'Actionable future work',
  'Intellectual independence',
];

function evaluation(maxScores: number[]): string {
  return JSON.stringify({
    score: 60,
    overview: 'A grounded evaluation.',
    rubric: criticalCriteria.map((criterion, index) => ({ criterion, score: 10, maxScore: maxScores[index], feedback: 'Specific feedback.' })),
    strengths: ['Accurate framing.'],
    improvements: ['Deepen the evidence analysis.'],
    evidence: [{ page: 1, quote: 'model is revised underwater', label: 'Core evidence' }],
  });
}

describe.each(AI_PROVIDERS)('%s shared evaluation validation', (provider) => {
  const makeService = (tempDirectory = '') => new AiEvaluationService(
    { getApiKey: () => 'fixture-key' } as never,
    { getSetting: (key: string, fallback = '') => key === 'activeProvider' ? provider : fallback } as never,
    { tempDirectory } as never,
    () => ({ id: provider, documentMode: provider === 'kimi' ? 'page-images' : 'pdf', complete: vi.fn() }),
  );


  it('repairs an invalid citation without changing earned quiz points and records content-free diagnostics', async () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-validation-'));
    const service = makeService(tempDirectory);
    const questions = Array.from({ length: 6 }, (_, index) => ({
      id: `q${index + 1}`, type: 'short-answer' as const, prompt: 'Explain the evidence.', focus: 'Evidence',
    }));
    const valid = {
      totalScore: 100, overview: 'One answer is incorrect.', strengths: ['Five correct answers.'], gaps: ['Revisit question six.'],
      questionGrades: [17, 17, 17, 17, 16, 16].map((maxScore, index) => ({
        questionId: questions[index].id, score: index === 5 ? 0 : maxScore, maxScore,
        verdict: index === 5 ? 'incorrect' : 'correct', feedback: 'Grounded feedback.',
        evidence: [{ page: 1, quote: 'model is revised underwater' }],
      })),
    };
    const invalid = structuredClone(valid);
    invalid.questionGrades[5].evidence[0].quote = 'PRIVATE_RESPONSE_SENTINEL altered quote';
    const askWithPaper = vi.fn().mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce(JSON.stringify(valid));
    (service as unknown as { askWithPaper: typeof askWithPaper }).askWithPaper = askWithPaper;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { value: result } = await service.gradeQuiz({
        managedPath: 'unused-by-stub.pdf', searchable: true, title: 'Test paper', pageCount: 1,
        extractedText: '[Page 1]\nThe model is revised underwater with evidence.',
      }, questions, Object.fromEntries(questions.map((question) => [question.id, 'A saved answer.'])));
      expect(result.totalScore).toBe(84);
      expect(result.questionGrades[5]).toMatchObject({ score: 0, maxScore: 16, verdict: 'incorrect' });
      expect(askWithPaper).toHaveBeenCalledTimes(2);
      expect(askWithPaper.mock.calls[1][1]).toContain('citation 6 quote was not found on PDF page 1');
      const log = fs.readFileSync(path.join(tempDirectory, 'litrevolt-validation.log'), 'utf8');
      expect(JSON.parse(log)).toMatchObject({ stage: 'quiz', attempt: 1, reason: 'citation 6 quote was not found on PDF page 1' });
      expect(log).not.toContain('PRIVATE_RESPONSE_SENTINEL');
      expect(log).not.toContain('A saved answer.');
    } finally {
      warning.mockRestore();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });


  it('retries a six-criterion 120-point response with an exact 100-point contract', async () => {
    const service = makeService();
    const askWithPaper = vi.fn()
      .mockResolvedValueOnce(evaluation([20, 20, 20, 20, 20, 20]))
      .mockResolvedValueOnce(evaluation([17, 17, 17, 17, 16, 16]));
    (service as unknown as { askWithPaper: typeof askWithPaper }).askWithPaper = askWithPaper;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { value: result } = await service.evaluateWriting({
      managedPath: 'unused-by-stub.pdf',
      searchable: true,
      title: 'Test paper',
      pageCount: 1,
      extractedText: '[Page 1]\nThe model is revised underwater with evidence.',
    }, 'critical-review', 'A sufficiently long critical review.');

    expect(result.score).toBe(60);
    expect(result.rubric.map((item) => item.maxScore)).toEqual([17, 17, 17, 17, 16, 16]);
    expect(askWithPaper).toHaveBeenCalledTimes(2);
    expect(askWithPaper.mock.calls[0][1]).toContain('"maxScore":17');
    expect(askWithPaper.mock.calls[0][1]).toContain('"maxScore":16');
    expect(askWithPaper.mock.calls[1][1]).toContain('VALIDATION RETRY');
    warning.mockRestore();
  });

  it('derives writing totals from earned rubric points and still rejects over-maximum judgments', async () => {
    const service = makeService();
    const valid = JSON.parse(evaluation([17, 17, 17, 17, 16, 16]));
    valid.score = 100; // Redundant model arithmetic is deliberately wrong; earned points total 60.
    const invalid = structuredClone(valid);
    invalid.rubric[0].score = 20;
    const askWithPaper = vi.fn().mockResolvedValueOnce(JSON.stringify(invalid)).mockResolvedValueOnce(JSON.stringify(valid));
    (service as unknown as { askWithPaper: typeof askWithPaper }).askWithPaper = askWithPaper;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { value: result } = await service.evaluateWriting({ managedPath: 'unused.pdf', searchable: true, title: 'Test', pageCount: 1,
        extractedText: '[Page 1]\nThe model is revised underwater with evidence.',
      }, 'critical-review', 'A sufficiently long critical review.');
      expect(result.score).toBe(60);
      expect(askWithPaper.mock.calls[1][1]).toContain('rubric criterion 1 earned 20 points but its maximum is 17');
    } finally {
      warning.mockRestore();
    }
  });
});
