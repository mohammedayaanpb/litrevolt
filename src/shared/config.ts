import type { AiProviderConfig, AiProviderId } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

export const AI_PROVIDERS = ['anthropic', 'openai', 'kimi', 'gemini'] as const;
export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', kimi: 'Kimi', gemini: 'Gemini',
};
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  anthropic: DEFAULT_CLAUDE_MODEL, openai: 'gpt-6-sol', kimi: 'kimi-k3', gemini: 'gemini-3.8-flash',
};

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function validateProviderConfig(provider: AiProviderId, input: AiProviderConfig): AiProviderConfig {
  if (!isAiProviderId(provider)) throw new Error('Choose a supported AI provider.');
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) {
    throw new Error(`Enter a valid ${PROVIDER_LABELS[provider]} API model ID.`);
  }
  const workspaceId = input.anthropicWorkspaceId?.trim() ?? '';
  if (provider !== 'anthropic' && workspaceId) throw new Error('Workspace IDs apply only to Anthropic.');
  if (workspaceId && !/^wrkspc_[a-zA-Z0-9]{1,100}$/.test(workspaceId)) {
    throw new Error('Enter a valid Anthropic workspace ID beginning with wrkspc_, or leave it blank.');
  }
  return provider === 'anthropic' ? { model, anthropicWorkspaceId: workspaceId } : { model };
}

export const LEGACY_DEFAULT_CLAUDE_MODELS = new Set([
  'claude-sonnet-4-20250514',
]);
