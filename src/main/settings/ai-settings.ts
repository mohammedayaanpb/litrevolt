import type { AiProviderConfig, AiProviderId } from '../../shared/types';
import { AI_PROVIDERS, DEFAULT_MODELS, isAiProviderId, LEGACY_DEFAULT_CLAUDE_MODELS, validateProviderConfig } from '../../shared/config';

interface SettingsReader {
  getSetting(key: string, fallback?: string): string;
}

export interface AiSettings {
  activeProvider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfig>;
}

export function defaultProviderSettings(): AiSettings['providers'] {
  return {
    anthropic: { model: DEFAULT_MODELS.anthropic, anthropicWorkspaceId: '' },
    openai: { model: DEFAULT_MODELS.openai },
    kimi: { model: DEFAULT_MODELS.kimi },
    gemini: { model: DEFAULT_MODELS.gemini },
  };
}

/** Also reads pre-provider libraries so migration preserves custom Anthropic settings. */
export function readAiSettings(database: SettingsReader): AiSettings {
  const providers = defaultProviderSettings();
  const rawProviders = database.getSetting('providers');
  if (rawProviders) {
    let stored: Partial<Record<AiProviderId, AiProviderConfig>>;
    try { stored = JSON.parse(rawProviders); } catch { throw new Error('LitRevolt could not read its AI provider settings.'); }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('LitRevolt could not read its AI provider settings.');
    for (const provider of AI_PROVIDERS) {
      if (stored[provider]) providers[provider] = validateProviderConfig(provider, stored[provider]);
    }
  } else {
    const model = database.getSetting('model', DEFAULT_MODELS.anthropic);
    providers.anthropic = validateProviderConfig('anthropic', {
      model: LEGACY_DEFAULT_CLAUDE_MODELS.has(model) ? DEFAULT_MODELS.anthropic : model,
      anthropicWorkspaceId: database.getSetting('anthropicWorkspaceId', ''),
    });
  }
  const activeProvider = database.getSetting('activeProvider', 'anthropic');
  if (!isAiProviderId(activeProvider)) throw new Error('Choose a supported AI provider in Settings.');
  return { activeProvider, providers };
}
