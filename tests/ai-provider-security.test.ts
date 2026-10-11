import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvider, providerError } from '../src/main/ai/providers';
import type { AiRequest } from '../src/main/ai/types';
import { AI_PROVIDERS, DEFAULT_MODELS } from '../src/shared/config';
import { userMessageForError } from '../src/shared/errors';
import type { AiProviderId } from '../src/shared/types';

const officialUrls: Record<AiProviderId, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/responses',
  kimi: 'https://api.moonshot.ai/v1/chat/completions',
  gemini: `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.gemini}:generateContent`,
};

beforeEach(() => {
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'GOOGLE_GENAI_ACCESS_TOKEN']) {
    vi.stubEnv(name, `AMBIENT_${name}`);
  }
  vi.stubEnv('OPENAI_ORG_ID', 'AMBIENT_OPENAI_ORGANIZATION');
  vi.stubEnv('OPENAI_PROJECT_ID', 'AMBIENT_OPENAI_PROJECT');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://untrusted.example/anthropic');
  vi.stubEnv('OPENAI_BASE_URL', 'https://untrusted.example/openai');
  vi.stubEnv('ANTHROPIC_LOG', 'debug');
  vi.stubEnv('OPENAI_LOG', 'debug');
  vi.stubEnv('GOOGLE_GENAI_DEBUG', 'true');
  vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');
  vi.stubEnv('GOOGLE_GENAI_USE_ENTERPRISE', 'true');
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'AMBIENT_GOOGLE_PROJECT');
  vi.stubEnv('GOOGLE_CLOUD_LOCATION', 'AMBIENT_GOOGLE_LOCATION');
  vi.stubEnv('GOOGLE_GENAI_API_VERSION', 'untrusted-version');
  vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://untrusted.example/gemini');
  vi.stubEnv('GOOGLE_VERTEX_BASE_URL', 'https://untrusted.example/vertex');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(provider: AiProviderId): AiRequest {
  return {
    model: DEFAULT_MODELS[provider], system: 'Evaluator instructions', prompt: 'PRIVATE_READER_ANSWER', maxTokens: 2048,
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, schemaName: 'security_probe',
    paper: {
      title: 'PRIVATE_PAPER_TITLE', pageCount: 1, pageText: '[{"page":1,"text":"PRIVATE_PAPER_CONTENT"}]',
      documentMode: provider === 'kimi' ? 'page-images' : 'pdf', pdf: 'PRIVATE_PDF_CONTENT',
      images: [{ page: 1, data: 'PRIVATE_PAGE_IMAGE' }],
    },
  };
}

function response(provider: AiProviderId) {
  if (provider === 'gemini') return { modelVersion: DEFAULT_MODELS.gemini, candidates: [{
    finishReason: 'STOP', content: { role: 'model', parts: [{ text: '{"ok":true}' }] },
  }] };
  if (provider === 'anthropic') return {
    id: 'msg_security', type: 'message', role: 'assistant', model: DEFAULT_MODELS[provider], stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 5 },
  };
  if (provider === 'openai') return {
    id: 'resp_security', object: 'response', status: 'completed', model: DEFAULT_MODELS[provider],
    output: [{ id: 'msg_security', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }],
    }],
  };
  return {
    id: 'chat_security', object: 'chat.completion', model: DEFAULT_MODELS[provider],
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
  };
}

function transport(value: unknown, status = 200) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function captureConsole() {
  const messages: unknown[][] = [];
  for (const method of ['debug', 'log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { messages.push(args); });
  }
  return messages;
}

describe.each(AI_PROVIDERS)('%s SDK environment isolation', (provider) => {
  it('uses the chosen key and official endpoint despite ambient SDK authentication and routing settings', async () => {
    const fetch = transport(response(provider));
    const adapter = createProvider(provider, { model: DEFAULT_MODELS[provider] }, 'CHOSEN_PROVIDER_KEY');
    await adapter.complete(request(provider));
    const [url, init] = fetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(String(url)).toBe(officialUrls[provider]);
    if (provider === 'anthropic') {
      expect(headers.get('x-api-key')).toBe('CHOSEN_PROVIDER_KEY');
      expect(headers.has('authorization')).toBe(false);
    } else if (provider === 'gemini') {
      expect(headers.get('x-goog-api-key')).toBe('CHOSEN_PROVIDER_KEY');
      expect(headers.has('authorization')).toBe(false);
      expect(JSON.stringify([...headers.entries()])).not.toContain('AMBIENT_');
      expect(String(url)).not.toContain('CHOSEN_PROVIDER_KEY');
    } else {
      expect(headers.get('authorization')).toBe('Bearer CHOSEN_PROVIDER_KEY');
      expect(headers.has('x-api-key')).toBe(false);
    }
    if (provider === 'kimi') {
      expect(headers.has('openai-organization')).toBe(false);
      expect(headers.has('openai-project')).toBe(false);
      expect(JSON.stringify([...headers.entries()])).not.toContain('AMBIENT_');
    }
    expect(headers.get('authorization') ?? '').not.toContain('AMBIENT_');
    expect(headers.get('x-api-key') ?? '').not.toContain('AMBIENT_');
  });

  it.each([false, true])('does not emit SDK request or response logs when ambient debug logging is enabled (failure=%s)', async (failure) => {
    const messages = captureConsole();
    transport(failure ? { error: { message: 'PRIVATE_REMOTE_RESPONSE', type: 'invalid_request_error' } } : response(provider), failure ? 400 : 200);
    const adapter = createProvider(provider, { model: DEFAULT_MODELS[provider] }, 'PRIVATE_SELECTED_KEY');
    if (failure) {
      await expect(adapter.complete(request(provider))).rejects.toThrow('could not process this AI request');
    } else {
      await expect(adapter.complete(request(provider))).resolves.toMatchObject({ status: 'complete' });
    }
    // Google's Node SDK emits this fixed, content-free warning at construction
    // when both environment keys exist, even though our explicit key wins.
    expect(messages).toEqual(provider === 'gemini'
      ? [['Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.']]
      : []);
  });
});

describe('normalized workspace guidance', () => {
  it.each([
    ['This API key is not scoped to a workspace; include anthropic-workspace-id. PRIVATE_DETAIL',
      'This API key requires an Anthropic workspace ID. Enter it in Settings and test the connection again.'],
    ['Workspace wrkspc_PRIVATE not found. PRIVATE_DETAIL',
      'Anthropic could not access the configured workspace. Check the workspace ID and your key’s access in Settings.'],
  ])('preserves the actionable safe message through IPC for %s', (detail, expected) => {
    const normalized = providerError('anthropic', new Error(detail));
    expect(normalized.message).toBe(expected);
    expect(userMessageForError(normalized, 'Fallback')).toBe(expected);
    expect(userMessageForError(new Error(`Error invoking remote method 'app:test-api-key': Error: ${normalized.message}`), 'Fallback')).toBe(expected);
    expect(normalized.message).not.toContain('PRIVATE');
  });
});
