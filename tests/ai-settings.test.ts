import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, DEFAULT_MODELS } from '../src/shared/config';
import { aiSettingsReducer, createAiSettingsDraft, hasPendingAiSettings, selectedAiSettingsUpdate } from '../src/renderer/ai-settings';

const saved = {
  activeProvider: 'anthropic' as const,
  providers: {
    anthropic: { model: 'custom-claude', anthropicWorkspaceId: 'wrkspc_example', apiKeyConfigured: true },
    openai: { model: DEFAULT_MODELS.openai, apiKeyConfigured: false },
    kimi: { model: DEFAULT_MODELS.kimi, apiKeyConfigured: true },
    gemini: { model: DEFAULT_MODELS.gemini, apiKeyConfigured: false },
  },
};

describe('AI settings drafts', () => {
  it('keeps Gemini activation pending after a successful connection test until its settings are saved', () => {
    let draft = aiSettingsReducer(createAiSettingsDraft(saved), { type: 'provider', provider: 'gemini' });
    draft = aiSettingsReducer(draft, { type: 'key', apiKey: 'unsaved-gemini-key' });
    draft = aiSettingsReducer(draft, { type: 'tested', result: { ok: true, message: 'Connected successfully.' } });
    expect(hasPendingAiSettings(draft, saved)).toBe(true);
    const update = selectedAiSettingsUpdate(draft);
    expect(update).toEqual({ activeProvider: 'gemini', providers: { gemini: { model: DEFAULT_MODELS.gemini } } });
    expect(saved.activeProvider).toBe('anthropic');
    expect(hasPendingAiSettings(draft, { ...saved, activeProvider: 'gemini' })).toBe(false);
  });

  it('saves only the displayed AI configuration without leaking credentials or unrelated provider drafts', () => {
    let draft = aiSettingsReducer(createAiSettingsDraft(saved), { type: 'config', config: { model: '' } });
    draft = aiSettingsReducer(draft, { type: 'provider', provider: 'gemini' });
    draft = aiSettingsReducer(draft, { type: 'config', config: { model: ' gemini-custom ' } });
    draft = aiSettingsReducer(draft, { type: 'key', apiKey: 'unsaved-secret' });
    expect(selectedAiSettingsUpdate(draft)).toEqual({ activeProvider: 'gemini', providers: { gemini: { model: 'gemini-custom' } } });
    expect(draft.providers.anthropic.model).toBe('');
    expect(draft.apiKey).toBe('unsaved-secret');
  });

  it('tracks active model and workspace edits without treating unsaved keys or whitespace as activation changes', () => {
    let draft = createAiSettingsDraft(saved);
    expect(hasPendingAiSettings(draft, saved)).toBe(false);
    draft = aiSettingsReducer(draft, { type: 'key', apiKey: 'replacement-key' });
    draft = aiSettingsReducer(draft, { type: 'config', config: { model: ' custom-claude ', anthropicWorkspaceId: ' wrkspc_example ' } });
    expect(hasPendingAiSettings(draft, saved)).toBe(false);
    draft = aiSettingsReducer(draft, { type: 'config', config: { anthropicWorkspaceId: 'wrkspc_updated' } });
    expect(hasPendingAiSettings(draft, saved)).toBe(true);
    expect(selectedAiSettingsUpdate(draft)).toEqual({ activeProvider: 'anthropic', providers: { anthropic: { model: 'custom-claude', anthropicWorkspaceId: 'wrkspc_updated' } } });
    draft = aiSettingsReducer(draft, { type: 'config', config: { model: 'another-model', anthropicWorkspaceId: 'wrkspc_example' } });
    expect(hasPendingAiSettings(draft, saved)).toBe(true);
  });

  it.each(AI_PROVIDERS)('keeps %s unsaved configuration separate and clears keys on switching', (provider) => {
    let state = aiSettingsReducer(createAiSettingsDraft(saved), { type: 'provider', provider });
    state = aiSettingsReducer(state, { type: 'custom', custom: true });
    state = aiSettingsReducer(state, { type: 'config', config: { model: `custom-${provider}` } });
    state = aiSettingsReducer(state, { type: 'key', apiKey: `${provider}-unsaved-key` });
    state = aiSettingsReducer(state, { type: 'tested', result: { ok: true, message: 'Synthetic check passed.' } });
    expect({ provider: state.provider, ...state.providers[state.provider], apiKey: state.apiKey }).toMatchObject({ provider, model: `custom-${provider}`, apiKey: `${provider}-unsaved-key` });
    const other = provider === 'anthropic' ? 'gemini' : 'anthropic';
    state = aiSettingsReducer(state, { type: 'provider', provider: other });
    expect(state.apiKey).toBe('');
    expect(state.connectionResult).toBeNull();
    expect(state.providers[other].model).toBe(saved.providers[other].model);
    state = aiSettingsReducer(state, { type: 'provider', provider });
    expect(state.apiKey).toBe('');
    expect(state.providers[provider].model).toBe(`custom-${provider}`);
    expect(state.customModels[provider]).toBe(true);
    state = aiSettingsReducer(state, { type: 'custom', custom: false });
    expect(state.providers[provider].model).toBe(DEFAULT_MODELS[provider]);
    if (provider !== 'anthropic') expect(state.providers[provider].anthropicWorkspaceId).toBeUndefined();
  });

  it('isolates entered credentials and test status while preserving provider model drafts', () => {
    let state = createAiSettingsDraft(saved);
    state = aiSettingsReducer(state, { type: 'key', apiKey: 'anthropic-input' });
    state = aiSettingsReducer(state, { type: 'tested', result: { ok: true, message: 'Synthetic check passed.' } });
    state = aiSettingsReducer(state, { type: 'provider', provider: 'openai' });
    expect(state.apiKey).toBe('');
    expect(state.connectionResult).toBeNull();
    expect(state.providers.openai).toEqual({ model: DEFAULT_MODELS.openai });
    state = aiSettingsReducer(state, { type: 'custom', custom: true });
    state = aiSettingsReducer(state, { type: 'config', config: { model: 'custom-openai' } });
    state = aiSettingsReducer(state, { type: 'key', apiKey: 'openai-input' });
    state = aiSettingsReducer(state, { type: 'provider', provider: 'anthropic' });
    expect(state.providers.anthropic).toEqual({ model: 'custom-claude', anthropicWorkspaceId: 'wrkspc_example' });
    expect(state.apiKey).toBe('');
    state = aiSettingsReducer(state, { type: 'provider', provider: 'openai' });
    expect(state.providers.openai.model).toBe('custom-openai');
    expect(state.customModels.openai).toBe(true);
    expect(state.apiKey).toBe('');
    expect(saved.providers.openai.model).toBe(DEFAULT_MODELS.openai);
  });

  it('invalidates connection results when any submitted configuration changes', () => {
    const tested = aiSettingsReducer(createAiSettingsDraft(saved), { type: 'tested', result: { ok: true, message: 'Passed' } });
    expect(aiSettingsReducer(tested, { type: 'config', config: { model: 'another-model' } }).connectionResult).toBeNull();
    expect(aiSettingsReducer(tested, { type: 'config', config: { anthropicWorkspaceId: 'wrkspc_other' } }).connectionResult).toBeNull();
    expect(aiSettingsReducer(tested, { type: 'key', apiKey: 'replacement' }).connectionResult).toBeNull();
    const preset = aiSettingsReducer(tested, { type: 'custom', custom: false });
    expect(preset.connectionResult).toBeNull();
    expect(preset.providers.anthropic.model).toBe(DEFAULT_MODELS.anthropic);
    expect(preset.providers.anthropic.anthropicWorkspaceId).toBe('wrkspc_example');
    expect(preset.providers.kimi.model).toBe(DEFAULT_MODELS.kimi);
  });
});
