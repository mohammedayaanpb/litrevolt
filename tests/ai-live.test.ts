import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AiEvaluationService } from '../src/main/ai/ai-evaluation-service';
import { citationAppearsOnPage, extractedPages } from '../src/main/ai/validation';
import { LitRevoltDatabase } from '../src/main/database/database';
import { PdfService } from '../src/main/papers/pdf-service';
import { defaultProviderSettings } from '../src/main/settings/ai-settings';
import { StorageManager } from '../src/main/settings/storage';
import { isAiProviderId } from '../src/shared/config';
import { AI_PAPER_FIXTURE, makeAiPaperPdf } from './fixtures/ai-paper';

// This suite makes paid network calls only with explicit operator opt-in.
// Default CI/local test runs do not inspect or use any provider credentials.
describe.skipIf(process.env.LITREVOLT_LIVE_AI !== '1')('opt-in synthetic AI benchmark', () => {
  it('checks visual JSON, quizzes, grounded grading, and writing discrimination', async () => {
    const provider = process.env.LITREVOLT_LIVE_PROVIDER;
    if (!isAiProviderId(provider)) throw new Error('Set LITREVOLT_LIVE_PROVIDER to anthropic, openai, kimi, or gemini.');
    const apiKey = process.env.LITREVOLT_LIVE_API_KEY?.trim();
    if (!apiKey) throw new Error('Set LITREVOLT_LIVE_API_KEY for the explicitly selected live provider.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-ai-live-'));
    let database: LitRevoltDatabase | undefined;
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const started = Date.now();
    const metrics: Record<string, string | number | boolean> = { provider, passed: false };
    try {
      const storage = new StorageManager(path.join(directory, 'bootstrap'));
      storage.initialize(path.join(directory, 'library'));
      database = new LitRevoltDatabase(storage.databasePath);
      const providers = defaultProviderSettings();
      if (process.env.LITREVOLT_LIVE_MODEL) providers[provider].model = process.env.LITREVOLT_LIVE_MODEL.trim();
      if (provider === 'anthropic') providers.anthropic.anthropicWorkspaceId = process.env.LITREVOLT_LIVE_WORKSPACE_ID?.trim() ?? '';
      database.setSettings({ activeProvider: provider, providers: JSON.stringify(providers) });
      const filename = path.join(directory, 'synthetic.pdf');
      fs.writeFileSync(filename, makeAiPaperPdf());
      const imported = await new PdfService(database, storage).importFile(filename);
      const source = database.getPaperSource(imported.paper.id);
      const service = new AiEvaluationService({ getApiKey: () => apiKey } as never, database, storage);
      await service.testConnection({ provider, ...providers[provider], apiKey });
      metrics.visualJson = true;
      const quiz = await service.generateQuiz(source, 1);
      expect(quiz.value.length, 'Pass 1 quiz must have five questions').toBe(5);
      expect(new Set(quiz.value.map((question) => question.type)).size, 'Quiz must include both question types').toBe(2);
      metrics.generatedQuestions = quiz.value.length;
      const correct = await service.gradeQuiz(source, AI_PAPER_FIXTURE.questions, AI_PAPER_FIXTURE.correctAnswers);
      const incorrect = await service.gradeQuiz(source, AI_PAPER_FIXTURE.questions, AI_PAPER_FIXTURE.incorrectAnswers);
      const accurate = await service.evaluateWriting(source, 'summary', AI_PAPER_FIXTURE.accurateSummary);
      const inaccurate = await service.evaluateWriting(source, 'summary', AI_PAPER_FIXTURE.inaccurateSummary);
      const pages = extractedPages(source.extractedText);
      const citations = [
        ...correct.value.questionGrades.flatMap((grade) => grade.evidence),
        ...incorrect.value.questionGrades.flatMap((grade) => grade.evidence),
        ...accurate.value.evidence, ...inaccurate.value.evidence,
      ];
      const citationsValid = citations.length > 0 && citations.every((citation) =>
        citation.page >= 1 && citation.page <= source.pageCount && citationAppearsOnPage(pages.get(citation.page) ?? '', citation.quote));
      Object.assign(metrics, {
        model: correct.provenance.model,
        correctQuizScore: correct.value.totalScore, incorrectQuizScore: incorrect.value.totalScore,
        accurateWritingScore: accurate.value.score, inaccurateWritingScore: inaccurate.value.score,
        verifiedCitations: citations.length, citationsValid,
      });
      expect(citationsValid, 'Every evidence quotation must occur on its cited page').toBe(true);
      expect(correct.value.totalScore >= 75, 'Known-correct answers should receive at least 75 points').toBe(true);
      expect(correct.value.totalScore - incorrect.value.totalScore >= 40, 'Correct answers should outscore contradicted answers by at least 40 points').toBe(true);
      expect(accurate.value.score - inaccurate.value.score >= 30, 'Accurate writing should outscore contradicted writing by at least 30 points').toBe(true);
      metrics.passed = true;
    } catch {
      // Keep SDK bodies, model responses, and credentials out of test output.
      throw new Error('Synthetic live AI benchmark failed. Inspect aggregate metrics and the selected provider/model configuration.');
    } finally {
      database?.close();
      warnings.mockRestore();
      errors.mockRestore();
      metrics.elapsedMilliseconds = Date.now() - started;
      console.info('[LitRevolt live benchmark]', JSON.stringify(metrics));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 600_000);
});
