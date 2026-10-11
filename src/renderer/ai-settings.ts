import { DEFAULT_MODELS } from '../shared/config';
import type { AiProviderConfig, AiProviderId, ApiResult, AppSettings, SaveSettingsInput } from '../shared/types';

export interface AiSettingsDraft {
  provider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfig>;
  customModels: Record<AiProviderId, boolean>;
  apiKey: string;
  connectionResult: ApiResult | null;
}

/** Activate only the displayed provider/configuration, never an entered key or other drafts. */
export function selectedAiSettingsUpdate(draft: AiSettingsDraft): SaveSettingsInput {
  const config = draft.providers[draft.provider];
  return {
    activeProvider: draft.provider,
    providers: {
      [draft.provider]: draft.provider === 'anthropic'
        ? { model: config.model.trim(), anthropicWorkspaceId: config.anthropicWorkspaceId?.trim() ?? '' }
        : { model: config.model.trim() },
    },
  };
}

export function hasPendingAiSettings(draft: AiSettingsDraft, settings: Pick<AppSettings, 'activeProvider' | 'providers'>): boolean {
  if (draft.provider !== settings.activeProvider) return true;
  const config = draft.providers[draft.provider];
  const saved = settings.providers[draft.provider];
  return config.model.trim() !== saved.model
    || (draft.provider === 'anthropic' && (config.anthropicWorkspaceId?.trim() ?? '') !== (saved.anthropicWorkspaceId ?? ''));
}

export function createAiSettingsDraft(settings: Pick<AppSettings, 'activeProvider' | 'providers'>): AiSettingsDraft {
  return {
    provider: settings.activeProvider,
    providers: {
      anthropic: { model: settings.providers.anthropic.model, anthropicWorkspaceId: settings.providers.anthropic.anthropicWorkspaceId ?? '' },
      openai: { model: settings.providers.openai.model },
      kimi: { model: settings.providers.kimi.model },
      gemini: { model: settings.providers.gemini.model },
    },
    customModels: {
      anthropic: settings.providers.anthropic.model !== DEFAULT_MODELS.anthropic,
      openai: settings.providers.openai.model !== DEFAULT_MODELS.openai,
      kimi: settings.providers.kimi.model !== DEFAULT_MODELS.kimi,
      gemini: settings.providers.gemini.model !== DEFAULT_MODELS.gemini,
    },
    apiKey: '',
    connectionResult: null,
  };
}

type DraftAction =
  | { type: 'provider'; provider: AiProviderId }
  | { type: 'config'; config: Partial<AiProviderConfig> }
  | { type: 'custom'; custom: boolean }
  | { type: 'key'; apiKey: string }
  | { type: 'tested'; result: ApiResult };

export function aiSettingsReducer(state: AiSettingsDraft, action: DraftAction): AiSettingsDraft {
  switch (action.type) {
    case 'provider': return { ...state, provider: action.provider, apiKey: '', connectionResult: null };
    case 'config': return { ...state, providers: { ...state.providers, [state.provider]: { ...state.providers[state.provider], ...action.config } }, connectionResult: null };
    case 'custom': return {
      ...state,
      customModels: { ...state.customModels, [state.provider]: action.custom },
      providers: action.custom ? state.providers : { ...state.providers, [state.provider]: { ...state.providers[state.provider], model: DEFAULT_MODELS[state.provider] } },
      connectionResult: null,
    };
    case 'key': return { ...state, apiKey: action.apiKey, connectionResult: null };
    case 'tested': return { ...state, connectionResult: action.result };
  }
}
