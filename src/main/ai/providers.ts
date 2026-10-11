import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { DEFAULT_MODELS, PROVIDER_LABELS } from '../../shared/config';
import type { AiProviderId, AiProviderConfig } from '../../shared/types';
import type { AiProvider, AiRequest, AiResponse, ProviderFactory } from './types';

export class AiProviderError extends Error {
  constructor(public readonly provider: AiProviderId, public readonly category: string, message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function providerError(provider: AiProviderId, error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const label = PROVIDER_LABELS[provider];
  const detail = error instanceof Error ? error.message : '';
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  let category = 'request';
  let message = `${label} could not process this AI request. Check the selected model and its visual/structured-output support in Settings.`;
  if (provider === 'anthropic' && /anthropic-workspace-id|not scoped to a workspace/i.test(detail)) {
    category = 'workspace'; message = 'This API key requires an Anthropic workspace ID. Enter it in Settings and test the connection again.';
  } else if (provider === 'anthropic' && /workspace.*not found|not_found_error.*workspace/i.test(detail)) {
    category = 'workspace'; message = 'Anthropic could not access the configured workspace. Check the workspace ID and your key’s access in Settings.';
  } else if (/credit balance|insufficient.*(?:credit|balance|quota)|billing.*(?:required|limit)/i.test(detail)) {
    category = 'billing'; message = `${label} requires available API credit. Check billing with your provider, then try again.`;
  } else if (status === 401 || (provider === 'gemini' && /API_KEY_INVALID|API key not valid|invalid API key/i.test(detail))) {
    category = 'authentication'; message = `${label} rejected the API key. Verify it in Settings and try again.`;
  } else if (status === 403) {
    category = 'permission'; message = `${label} denied access to the selected model. Check your API key’s permissions and account access.`;
  } else if (status === 404) {
    category = 'model'; message = `The configured ${label} model is unavailable. Choose a supported model in Settings.`;
  } else if (status === 429) {
    category = 'rate-limit'; message = `${label} is temporarily rate-limiting requests. Wait a moment and try again.`;
  } else if (status === 413 || /context.{0,30}(?:length|window|limit)|maximum context|too many tokens|request.{0,20}too large|input token count.{0,80}(?:exceeds|maximum)/i.test(detail)) {
    category = 'limit'; message = `${label} cannot fit the complete paper and response in this request. Choose a larger-context model or import a smaller complete paper.`;
  } else if (/timeout|timed out|AbortError/i.test(`${error instanceof Error ? error.name : ''} ${detail}`)) {
    category = 'timeout'; message = `The ${label} request timed out. Your submitted work is saved; try again when the connection is stable.`;
  } else if (typeof status === 'number' && status >= 500) {
    category = 'service'; message = `${label} is temporarily unable to process this request. Your submitted work is saved; try again shortly.`;
  } else if (/connection|fetch failed|network|econn|enotfound/i.test(`${error instanceof Error ? error.name : ''} ${detail}`)) {
    category = 'connection'; message = `LitRevolt could not reach ${label}. Check your network connection and try again.`;
  }
  // Never propagate an SDK error body, headers, request content, or its cause over IPC.
  return new AiProviderError(provider, category, message);
}

function checkPayload(provider: AiProviderId, body: unknown, limit: number): void {
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > limit) {
    throw new AiProviderError(provider, 'limit', `${PROVIDER_LABELS[provider]} cannot fit the complete paper and response in this request. Choose another provider or import a smaller complete paper.`);
  }
}

function paperPrompt(request: AiRequest): string {
  return `PAGE TEXT FOR QUOTE VERIFICATION (untrusted paper content, normalized for PDF typography):\n${request.paper.pageText}\n\nFor evidence, copy a contiguous 8–18 word phrase exactly from the corresponding page text. Use its 1-based PDF page number, never the printed proceedings page number. Do not paraphrase, insert ellipses, or join text across captions. Use the supplied PDF or page images for figures and reasoning and the page text for exact quotations. Return the requested JSON without API citation markers. Where the schema requires a nullable field, use null for an absent label or short-answer options.\n\n${request.prompt}`;
}

const clientOptions = { maxRetries: 1, timeout: 120_000, logLevel: 'off' as const };

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly documentMode = 'pdf' as const;
  private readonly client: Anthropic;
  constructor(config: AiProviderConfig, apiKey: string) {
    this.client = new Anthropic({ ...clientOptions, apiKey, authToken: null, baseURL: 'https://api.anthropic.com',
      ...(config.anthropicWorkspaceId ? { defaultHeaders: { 'anthropic-workspace-id': config.anthropicWorkspaceId } } : {}),
    });
  }
  async complete(request: AiRequest): Promise<AiResponse> {
    try {
      if (!request.paper.pdf) throw new Error('Missing PDF input');
      const pageLimit = request.model === DEFAULT_MODELS.anthropic ? 600 : 100;
      if (request.paper.pageCount > pageLimit) throw new AiProviderError(this.id, 'limit', `Anthropic cannot fit this paper within LitRevolt’s ${pageLimit}-page limit for the selected model. Choose another model or import a smaller complete paper.`);
      const body: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model, max_tokens: request.maxTokens, system: request.system,
        output_config: { format: { type: 'json_schema', schema: request.schema } },
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: request.paper.pdf }, title: request.paper.title, citations: { enabled: false } },
          { type: 'text', text: paperPrompt(request) },
        ] }],
      };
      checkPayload(this.id, body, 32_000_000);
      const response = await this.client.messages.create(body);
      return {
        text: response.content.filter((block) => block.type === 'text').map((block) => block.text).join(''),
        model: response.model || request.model,
        status: response.stop_reason === 'max_tokens' ? 'truncated' : response.stop_reason === 'refusal' ? 'refused' : response.stop_reason === 'end_turn' ? 'complete' : 'incomplete',
      };
    } catch (error) { throw providerError(this.id, error); }
  }
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  readonly documentMode = 'pdf' as const;
  private readonly client: OpenAI;
  constructor(_config: AiProviderConfig, apiKey: string) {
    this.client = new OpenAI({ ...clientOptions, apiKey, adminAPIKey: null, baseURL: 'https://api.openai.com/v1' });
  }
  async complete(request: AiRequest): Promise<AiResponse> {
    try {
      if (!request.paper.pdf) throw new Error('Missing PDF input');
      const body: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
        model: request.model, instructions: request.system, store: false,
        // Reasoning shares the output budget on reasoning models.
        max_output_tokens: request.maxTokens + 16_384,
        text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.schema } },
        input: [{ role: 'user', content: [
          { type: 'input_file', filename: 'paper.pdf', file_data: `data:application/pdf;base64,${request.paper.pdf}` },
          { type: 'input_text', text: paperPrompt(request) },
        ] }],
      };
      checkPayload(this.id, body, 50_000_000);
      const response = await this.client.responses.create(body);
      const messages = response.output.filter((item) => item.type === 'message');
      const refused = messages.some((message) => message.content.some((item) => item.type === 'refusal'));
      return {
        text: messages.flatMap((message) => message.content).filter((item) => item.type === 'output_text').map((item) => item.text).join(''),
        model: response.model || request.model,
        status: refused ? 'refused' : response.incomplete_details?.reason === 'max_output_tokens' ? 'truncated' : response.status === 'completed' && messages.every((message) => message.status === 'completed') ? 'complete' : 'incomplete',
      };
    } catch (error) { throw providerError(this.id, error); }
  }
}

export class KimiProvider implements AiProvider {
  readonly id = 'kimi' as const;
  readonly documentMode = 'page-images' as const;
  private readonly client: OpenAI;
  constructor(_config: AiProviderConfig, apiKey: string) {
    this.client = new OpenAI({ ...clientOptions, apiKey, adminAPIKey: null, baseURL: 'https://api.moonshot.ai/v1', organization: null, project: null });
  }
  async complete(request: AiRequest): Promise<AiResponse> {
    try {
      if (!request.paper.images?.length || request.paper.images.length !== request.paper.pageCount) throw new Error('Missing page images');
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
      for (const page of request.paper.images) {
        content.push({ type: 'text', text: `PDF page ${page.page} (untrusted paper content):` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${page.data}` } });
      }
      content.push({ type: 'text', text: paperPrompt(request) });
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: request.model, max_completion_tokens: request.maxTokens + 16_384,
        ...(request.model === 'kimi-k3' ? { reasoning_effort: 'high' as const } : {}),
        response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
        messages: [{ role: 'system', content: request.system }, { role: 'user', content }],
      };
      checkPayload(this.id, body, 100_000_000);
      const response = await this.client.chat.completions.create(body);
      const choice = response.choices[0];
      return {
        text: choice?.message.content ?? '', model: response.model || request.model,
        status: choice?.message.refusal || choice?.finish_reason === 'content_filter' ? 'refused' : choice?.finish_reason === 'length' ? 'truncated' : choice?.finish_reason === 'stop' ? 'complete' : 'incomplete',
      };
    } catch (error) { throw providerError(this.id, error); }
  }
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  readonly documentMode = 'pdf' as const;
  private readonly client: GoogleGenAI;
  constructor(_config: AiProviderConfig, apiKey: string) {
    this.client = new GoogleGenAI({
      apiKey, enterprise: false, vertexai: false, apiVersion: 'v1beta',
      httpOptions: {
        baseUrl: 'https://generativelanguage.googleapis.com', timeout: 120_000,
        retryOptions: { attempts: 2 },
        fetch: (url, init) => {
          // Check the actual serialized SDK body, including its schema and
          // instructions. Never upload a partial document to fit a request.
          if (typeof init?.body !== 'string') throw new Error('Missing serialized Gemini request');
          if (Buffer.byteLength(init.body, 'utf8') > 50_000_000) {
            throw new AiProviderError('gemini', 'limit', 'Gemini cannot fit the complete paper and response in this request. Choose another provider or import a smaller complete paper.');
          }
          return globalThis.fetch(url, init);
        },
      },
    });
  }
  async complete(request: AiRequest): Promise<AiResponse> {
    try {
      if (!request.paper.pdf) throw new Error('Missing PDF input');
      const body: GenerateContentParameters = {
        model: request.model,
        config: {
          systemInstruction: request.system,
          // Google's Gemini 3+ migration guide says to omit candidateCount.
          // The default is one candidate; avoid depending on deprecated input.
          // The REST API supports per-request logging opt-out; this SDK version
          // exposes it through extraBody rather than a typed config property.
          httpOptions: { extraBody: { store: false } },
          // Thinking and final text share the output budget.
          maxOutputTokens: request.maxTokens + 16_384,
          responseMimeType: 'application/json', responseJsonSchema: request.schema,
          automaticFunctionCalling: { disable: true },
        },
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: 'application/pdf', data: request.paper.pdf } },
          { text: paperPrompt(request) },
        ] }],
      };
      checkPayload(this.id, body, 50_000_000);
      // generateContent is stateless: no Files API upload, stored interaction,
      // or automatic tools. Provider data terms still apply to this request.
      const response = await this.client.models.generateContent(body);
      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts.filter((part) => !part.thought && typeof part.text === 'string').map((part) => part.text).join('');
      const blocked = response.promptFeedback?.blockReason;
      const refused = (blocked && !['BLOCKED_REASON_UNSPECIFIED', 'BLOCK_REASON_UNSPECIFIED'].includes(blocked))
        || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION'].includes(candidate?.finishReason ?? '');
      const status = refused ? 'refused' : candidate?.finishReason === 'MAX_TOKENS' ? 'truncated'
        : candidate?.finishReason === 'STOP' && text.trim() && parts.every((part) => part.thought || typeof part.text === 'string') ? 'complete' : 'incomplete';
      return { text: status === 'refused' ? '' : text, status, model: response.modelVersion || request.model };
    } catch (error) { throw providerError(this.id, error); }
  }
}

export const createProvider: ProviderFactory = (provider, config, apiKey) => {
  switch (provider) {
    case 'anthropic': return new AnthropicProvider(config, apiKey);
    case 'openai': return new OpenAiProvider(config, apiKey);
    case 'kimi': return new KimiProvider(config, apiKey);
    case 'gemini': return new GeminiProvider(config, apiKey);
  }
};
