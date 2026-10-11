import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiEvaluationService } from '../src/main/ai/ai-evaluation-service';
import * as paperInput from '../src/main/ai/paper-input';
import { AI_PROVIDERS, DEFAULT_MODELS } from '../src/shared/config';
import type { AiProviderId, QuizQuestion } from '../src/shared/types';
import type { AiRequest, AiResponse, PaperSource, ProviderFactory } from '../src/main/ai/types';

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function sourceFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-ai-operation-'));
  temporaryDirectories.push(directory);
  const managedPath = path.join(directory, 'paper.pdf');
  fs.writeFileSync(managedPath, paperInput.visualProbe().bytes);
  const source: PaperSource = { managedPath, searchable: true, title: 'Private paper', pageCount: 1,
    extractedText: '[Page 1]\nThis exact evidence sentence supports a claim in the supplied paper.',
  };
  return { directory, source };
}

function settingsReader(provider: AiProviderId) {
  const settings: Record<string, string> = { activeProvider: provider,
    providers: JSON.stringify(Object.fromEntries(AI_PROVIDERS.map((id) => [id, { model: DEFAULT_MODELS[id] }]))),
  };
  return { settings, database: { getSetting: (key: string, fallback = '') => settings[key] ?? fallback } };
}

describe.each(AI_PROVIDERS)('%s operation isolation', (id) => {
  it('keeps credentials, model and complete paper fixed across truncation and citation repair', async () => {
    const { directory, source } = sourceFixture();
    const { settings, database } = settingsReader(id);
    const questions: QuizQuestion[] = [{ id: 'q1', type: 'short-answer', prompt: 'Explain the claim.', focus: 'Evidence' }];
    const valid = { totalScore: 99, overview: 'Grounded evaluation', strengths: [], gaps: [], questionGrades: [{
      questionId: 'q1', score: 40, maxScore: 100, verdict: 'partial', feedback: 'Incomplete',
      evidence: [{ page: 1, quote: 'This exact evidence sentence supports a claim in the supplied paper.', label: null }],
    }] };
    const invalid = structuredClone(valid);
    invalid.questionGrades[0].evidence[0].quote = 'PRIVATE_INVALID_RESPONSE';
    const requests: AiRequest[] = [];
    const complete = vi.fn(async (request: AiRequest): Promise<AiResponse> => {
      requests.push(request);
      settings.activeProvider = id === 'kimi' ? 'openai' : 'kimi';
      settings.providers = JSON.stringify({ [id]: { model: 'new-model-after-start' } });
      return requests.length === 1 ? { status: 'truncated', text: 'partial', model: 'actual-model' }
        : { status: 'complete', text: JSON.stringify(requests.length === 2 ? invalid : valid), model: 'actual-model' };
    });
    const factory = vi.fn<ProviderFactory>(() => ({ id, documentMode: id === 'kimi' ? 'page-images' : 'pdf', complete }));
    const getApiKey = vi.fn(() => 'captured-key');
    const service = new AiEvaluationService({ getApiKey } as never, database as never, { papersDirectory: directory, tempDirectory: directory } as never, factory);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await service.gradeQuiz(source, questions, { q1: 'PRIVATE_SAVED_ANSWER' });
    expect(result.value.totalScore).toBe(40);
    expect(result.provenance).toEqual({ provider: id, model: 'actual-model', documentMode: id === 'kimi' ? 'page-images' : 'pdf' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(getApiKey).toHaveBeenCalledExactlyOnceWith(id);
    expect(requests.map((request) => request.model)).toEqual(Array(3).fill(DEFAULT_MODELS[id]));
    expect(requests.map((request) => request.maxTokens)).toEqual([6500, 13000, 6500]);
    expect(requests[1].paper).toBe(requests[0].paper);
    expect(requests[2].paper).toBe(requests[0].paper);
    expect(requests[2].prompt).toContain('citation 1 quote was not found on PDF page 1');
    expect(fs.readFileSync(path.join(directory, 'litrevolt-validation.log'), 'utf8')).not.toContain('PRIVATE_');
  });

  it.each(['truncated', 'refused', 'incomplete'] as const)('never returns a grade for %s output', async (status) => {
    const { directory, source } = sourceFixture();
    const { database } = settingsReader(id);
    const complete = vi.fn(async (): Promise<AiResponse> => ({ status, text: '{"looks":"valid"}', model: 'fixture-model' }));
    const service = new AiEvaluationService({ getApiKey: () => 'fixture-key' } as never, database as never,
      { papersDirectory: directory, tempDirectory: directory } as never,
      () => ({ id, documentMode: id === 'kimi' ? 'page-images' : 'pdf', complete }));
    await expect(service.generateQuiz(source, 1)).rejects.toThrow(status === 'refused' ? 'could not evaluate' : 'incomplete response');
    expect(complete).toHaveBeenCalledTimes(status === 'truncated' ? 2 : 1);
  });
});

it('logs safe categories and does not expose raw SDK failures', async () => {
  const { directory, source } = sourceFixture();
  const { database } = settingsReader('openai');
  const raw = Object.assign(new Error('PRIVATE_RESPONSE PRIVATE_KEY PRIVATE_HEADERS'), { status: 503 });
  const service = new AiEvaluationService({ getApiKey: () => 'fixture-key' } as never, database as never,
    { papersDirectory: directory, tempDirectory: directory } as never,
    () => ({ id: 'openai', documentMode: 'pdf', complete: vi.fn().mockRejectedValue(raw) }));
  await expect(service.generateQuiz(source, 1)).rejects.toThrow('OpenAI is temporarily unable');
  const log = fs.readFileSync(path.join(directory, 'litrevolt-validation.log'), 'utf8');
  expect(JSON.parse(log)).toMatchObject({ stage: 'request', reason: 'openai: service' });
  expect(log).not.toContain('PRIVATE_');
});

it.each(AI_PROVIDERS)('tests unsaved %s configuration without reading saved settings or sending reader data', async (id) => {
  const probe = paperInput.visualProbe();
  vi.spyOn(paperInput, 'visualProbe').mockReturnValue(probe);
  const getSetting = vi.fn(() => { throw new Error('Must not read saved settings'); });
  const getApiKey = vi.fn();
  const complete = vi.fn(async (): Promise<AiResponse> => ({ status: 'complete', text: JSON.stringify({ color: probe.color, shape: probe.shape }), model: 'custom-model' }));
  const factory = vi.fn<ProviderFactory>(() => ({ id, documentMode: id === 'kimi' ? 'page-images' : 'pdf', complete }));
  const service = new AiEvaluationService({ getApiKey } as never, { getSetting } as never, {} as never, factory);
  const configuration = { provider: id, model: 'custom-model', apiKey: ' draft-key ', ...(id === 'anthropic' ? { anthropicWorkspaceId: 'wrkspc_Draft' } : {}) };
  await service.testConnection(configuration);
  expect(factory.mock.calls[0][0]).toBe(id);
  expect(factory.mock.calls[0][1].model).toBe('custom-model');
  expect(factory.mock.calls[0][2]).toBe('draft-key');
  expect(getSetting).not.toHaveBeenCalled();
  expect(getApiKey).not.toHaveBeenCalled();
  const sent = complete.mock.calls as unknown as Array<[AiRequest]>;
  expect(sent[0][0].paper.pageText).toBe('[]');
  expect(sent[0][0].paper.pageCount).toBe(1);
  complete.mockResolvedValue({ status: 'complete', text: '{"color":"invisible","shape":"none"}', model: 'custom-model' });
  await expect(service.testConnection(configuration)).rejects.toThrow('expected visual JSON answer');
});
