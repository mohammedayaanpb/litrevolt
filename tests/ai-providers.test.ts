import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider, providerError } from '../src/main/ai/providers';
import { outputSchema } from '../src/main/ai/output-schemas';
import { userMessageForError } from '../src/shared/errors';
import { AI_PROVIDERS, DEFAULT_MODELS } from '../src/shared/config';
import type { AiProviderId } from '../src/shared/types';
import type { AiRequest } from '../src/main/ai/types';

afterEach(() => vi.unstubAllGlobals());

it.each(['quiz', 'grading', 'writing', 'connection'] as const)('keeps the %s output schema within the shared strict-JSON subset', (kind) => {
  const schema = outputSchema(kind);
  function inspect(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    for (const constraint of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      expect(node).not.toHaveProperty(constraint);
    }
    if (node.type === 'object') {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
    for (const child of Object.values(node)) inspect(child);
  }
  inspect(schema);
  if (kind === 'grading' || kind === 'writing') {
    expect(JSON.stringify(schema)).toContain('"page":{"type":"integer"}');
  }
});

function request(provider: AiProviderId): AiRequest {
  return { model: DEFAULT_MODELS[provider], system: 'Evaluator instruction', prompt: 'Grade the answer',
    maxTokens: 6500, schema: outputSchema('grading'), schemaName: 'grading',
    paper: { title: 'Test paper', pageCount: 2, pageText: '[{"page":1,"text":"EXACT_TEXT"}]',
      documentMode: provider === 'kimi' ? 'page-images' : 'pdf', pdf: 'PDF_BASE64',
      images: [{ page: 1, data: 'PAGE_ONE' }, { page: 2, data: 'PAGE_TWO' }],
    },
  };
}

function envelope(provider: AiProviderId, status: 'complete' | 'truncated' | 'refused' | 'incomplete' = 'complete') {
  if (provider === 'gemini') return { modelVersion: 'actual-model', candidates: [{
    finishReason: { complete: 'STOP', truncated: 'MAX_TOKENS', refused: 'SAFETY', incomplete: 'OTHER' }[status],
    content: { role: 'model', parts: [{ thought: true, text: 'PRIVATE_REASONING' }, { text: '{"ok":true}' }] },
  }] };
  if (provider === 'anthropic') return { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'actual-model',
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: { complete: 'end_turn', truncated: 'max_tokens', refused: 'refusal', incomplete: 'pause_turn' }[status],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
  if (provider === 'openai') return { id: 'resp_fixture', object: 'response', model: 'actual-model',
    status: status === 'complete' || status === 'refused' ? 'completed' : 'incomplete',
    incomplete_details: status === 'truncated' ? { reason: 'max_output_tokens' } : null,
    output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [
      status === 'refused' ? { type: 'refusal', refusal: 'PRIVATE_REFUSAL' } : { type: 'output_text', text: '{"ok":true}', annotations: [] },
    ] }],
  };
  return { id: 'chat_fixture', object: 'chat.completion', model: 'actual-model',
    choices: [{ index: 0, finish_reason: { complete: 'stop', truncated: 'length', refused: 'content_filter', incomplete: 'tool_calls' }[status],
      message: { role: 'assistant', content: '{"ok":true}', reasoning_content: 'PRIVATE_REASONING' },
    }],
  };
}

function mockTransport(response: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(response), {
    status, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe.each(AI_PROVIDERS)('%s API adapter', (provider) => {
  it('sends the complete visual paper, canonical text and schema only to its official endpoint', async () => {
    const fetch = mockTransport(envelope(provider));
    const adapter = createProvider(provider, { model: DEFAULT_MODELS[provider], anthropicWorkspaceId: 'wrkspc_Test' }, 'fixture-key');
    const result = await adapter.complete(request(provider));
    expect(result).toEqual({ text: '{"ok":true}', status: 'complete', model: 'actual-model' });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe({ anthropic: 'https://api.anthropic.com/v1/messages', openai: 'https://api.openai.com/v1/responses', kimi: 'https://api.moonshot.ai/v1/chat/completions', gemini: `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.gemini}:generateContent` }[provider]);
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    if (provider !== 'gemini') expect(body.model).toBe(DEFAULT_MODELS[provider]);
    expect(init.body).toContain('EXACT_TEXT');
    expect(init.body).toContain('additionalProperties');
    if (provider === 'anthropic') {
      expect(headers.get('x-api-key')).toBe('fixture-key');
      expect(headers.get('anthropic-workspace-id')).toBe('wrkspc_Test');
      expect(body.messages[0].content[0].source.data).toBe('PDF_BASE64');
      expect(body.output_config.format.type).toBe('json_schema');
    } else if (provider === 'gemini') {
      expect(headers.get('x-goog-api-key')).toBe('fixture-key');
      expect(headers.has('authorization')).toBe(false);
      expect(headers.has('anthropic-workspace-id')).toBe(false);
      expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'application/pdf', data: 'PDF_BASE64' });
      expect(body.systemInstruction.parts[0].text).toBe('Evaluator instruction');
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.responseJsonSchema).toEqual(outputSchema('grading'));
      expect(body.generationConfig.maxOutputTokens).toBe(6500 + 16384);
      // Follow the Gemini 3+ migration contract, even where servers still
      // tolerate an explicit candidate_count of 1. Omission defaults to one.
      expect(body.generationConfig).not.toHaveProperty('candidateCount');
      expect(body.store).toBe(false);
      expect(body).not.toHaveProperty('tools');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_REASONING');
    } else {
      expect(headers.get('authorization')).toBe('Bearer fixture-key');
      expect(headers.has('anthropic-workspace-id')).toBe(false);
      if (provider === 'openai') {
        expect(body.store).toBe(false);
        expect(body.input[0].content[0].file_data).toBe('data:application/pdf;base64,PDF_BASE64');
        expect(body.text.format.strict).toBe(true);
      } else {
        expect(body.response_format.json_schema.strict).toBe(true);
        expect(body.messages[1].content.slice(0, 4)).toEqual([
          { type: 'text', text: 'PDF page 1 (untrusted paper content):' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,PAGE_ONE' } },
          { type: 'text', text: 'PDF page 2 (untrusted paper content):' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,PAGE_TWO' } },
        ]);
        expect(body).not.toHaveProperty('temperature');
        expect(body.reasoning_effort).toBe('high');
        expect(JSON.stringify(result)).not.toContain('PRIVATE_REASONING');
      }
    }
  });

  it.each(['truncated', 'refused', 'incomplete'] as const)('normalizes %s output without accepting it as complete', async (status) => {
    mockTransport(envelope(provider, status));
    const result = await createProvider(provider, { model: DEFAULT_MODELS[provider] }, 'fixture-key').complete(request(provider));
    expect(result.status).toBe(status);
    expect(result.text).not.toContain('PRIVATE_');
  });

  it('sanitizes API failures before they cross IPC', async () => {
    mockTransport({ error: { message: 'PRIVATE_PAPER PRIVATE_KEY', type: 'invalid_request_error' } }, 401);
    const adapter = createProvider(provider, { model: DEFAULT_MODELS[provider] }, 'fixture-key');
    await expect(adapter.complete(request(provider))).rejects.toThrow('rejected the API key');
    try { await adapter.complete(request(provider)); } catch (error) {
      const safe = userMessageForError(error, 'Fallback');
      expect(safe).toContain({ anthropic: 'Anthropic', openai: 'OpenAI', kimi: 'Kimi', gemini: 'Gemini' }[provider]);
      expect(safe).not.toContain('PRIVATE');
    }
  });
});

it('rejects an oversized Gemini request before sending any paper data', async () => {
  const fetch = mockTransport(envelope('gemini'));
  const oversized = request('gemini');
  oversized.paper.pdf = 'A'.repeat(50_000_001);
  await expect(createProvider('gemini', { model: DEFAULT_MODELS.gemini }, 'fixture-key').complete(oversized)).rejects.toThrow('Gemini cannot fit the complete paper');
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'OTHER'])('rejects Gemini prompt-level blocking (%s) without leaking the response', async (blockReason) => {
  mockTransport({ modelVersion: 'gemini-server-model', promptFeedback: { blockReason, blockReasonMessage: 'PRIVATE_REASON' } });
  await expect(createProvider('gemini', { model: DEFAULT_MODELS.gemini }, 'fixture-key').complete(request('gemini')))
    .resolves.toEqual({ text: '', status: 'refused', model: 'gemini-server-model' });
});

it.each([
  {},
  { promptFeedback: { blockReason: 'BLOCK_REASON_UNSPECIFIED' } },
  { promptFeedback: { blockReason: 'BLOCKED_REASON_UNSPECIFIED' } },
  { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'PRIVATE_THOUGHT' }] } }] },
  { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"ok":true}' }, { functionCall: { name: 'unexpected', args: {} } }] } }] },
])('never treats an empty or unexpected Gemini response as a completed result', async (response) => {
  mockTransport(response);
  const result = await createProvider('gemini', { model: DEFAULT_MODELS.gemini }, 'fixture-key').complete(request('gemini'));
  expect(result.status).toBe('incomplete');
  expect(result.text).not.toContain('PRIVATE_');
  expect(result.model).toBe(DEFAULT_MODELS.gemini);
});

it('preserves safe Gemini-specific invalid-key and input-limit guidance through IPC', async () => {
  const adapter = createProvider('gemini', { model: DEFAULT_MODELS.gemini }, 'fixture-key');
  mockTransport({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. PRIVATE_DETAIL' } }, 400);
  await expect(adapter.complete(request('gemini'))).rejects.toThrow('Gemini rejected the API key');
  for (const detail of ['API_KEY_INVALID PRIVATE_KEY', 'The input token count exceeds the maximum number of tokens allowed PRIVATE_PAPER']) {
    const error = providerError('gemini', Object.assign(new Error(detail), { status: 400 }));
    expect(error.category).toBe(detail.startsWith('API') ? 'authentication' : 'limit');
    expect(userMessageForError(error, 'Fallback')).toBe(error.message);
    expect(error.message).not.toContain('PRIVATE');
  }
});

it('omits an unset Anthropic workspace and rejects oversized payloads before sending', async () => {
  const fetch = mockTransport(envelope('anthropic'));
  const adapter = createProvider('anthropic', { model: DEFAULT_MODELS.anthropic }, 'fixture-key');
  await adapter.complete(request('anthropic'));
  expect(new Headers(fetch.mock.calls[0][1].headers).has('anthropic-workspace-id')).toBe(false);
  fetch.mockClear();
  const oversized = request('anthropic');
  oversized.paper.pdf = 'A'.repeat(32_000_001);
  await expect(adapter.complete(oversized)).rejects.toThrow('cannot fit the complete paper');
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects missing page images rather than silently degrading Kimi to text', async () => {
  const fetch = mockTransport(envelope('kimi'));
  const incomplete = request('kimi');
  incomplete.paper.images?.pop();
  await expect(createProvider('kimi', { model: 'kimi-k3' }, 'fixture-key').complete(incomplete)).rejects.toThrow('visual/structured-output');
  expect(fetch).not.toHaveBeenCalled();
});

it.each(AI_PROVIDERS)('preserves %s identity for rate limits, context limits, timeout and billing errors', (provider) => {
  for (const error of [Object.assign(new Error('PRIVATE'), { status: 429 }), new Error('context length exceeded PRIVATE'), new Error('Request timed out PRIVATE'), new Error('insufficient_quota PRIVATE')]) {
    const safe = providerError(provider, error);
    expect(userMessageForError(safe, 'Fallback')).toBe(safe.message);
    expect(safe.message).not.toContain('PRIVATE');
  }
});
