import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, validateProviderConfig } from '../src/shared/config';
import { readAiSettings } from '../src/main/settings/ai-settings';

const reader = (settings: Record<string, string>) => ({ getSetting: (key: string, fallback = '') => settings[key] ?? fallback });

describe('provider settings migration', () => {
  it('defaults an existing library to Anthropic and preserves its custom model and workspace', () => {
    const settings = readAiSettings(reader({ model: 'claude-custom-model', anthropicWorkspaceId: 'wrkspc_custom123' }));
    expect(settings.activeProvider).toBe('anthropic');
    expect(settings.providers.anthropic).toEqual({ model: 'claude-custom-model', anthropicWorkspaceId: 'wrkspc_custom123' });
    expect(settings.providers.openai).toEqual({ model: DEFAULT_MODELS.openai });
    expect(settings.providers.kimi).toEqual({ model: DEFAULT_MODELS.kimi });
    expect(settings.providers.gemini).toEqual({ model: 'gemini-3.8-flash' });
  });

  it('upgrades the retired bundled model only during legacy migration', () => {
    expect(readAiSettings(reader({ model: 'claude-sonnet-4-20250514' })).providers.anthropic.model).toBe(DEFAULT_MODELS.anthropic);
    const saved = { activeProvider: 'kimi', providers: JSON.stringify({ anthropic: { model: 'claude-sonnet-4-20250514' }, kimi: { model: 'kimi-custom' } }) };
    expect(readAiSettings(reader(saved)).activeProvider).toBe('kimi');
    expect(readAiSettings(reader(saved)).providers.anthropic.model).toBe('claude-sonnet-4-20250514');
    expect(readAiSettings(reader(saved)).providers.kimi.model).toBe('kimi-custom');
  });

  it('preserves provider-specific selections across serializing and reopening settings', () => {
    const original = readAiSettings(reader({ model: 'claude-custom' }));
    original.activeProvider = 'openai';
    original.providers.openai.model = 'gpt-custom.2026';
    original.providers.kimi.model = 'kimi-preview';
    original.providers.gemini.model = 'gemini-custom-preview';
    const reopened = readAiSettings(reader({ activeProvider: original.activeProvider, providers: JSON.stringify(original.providers) }));
    expect(reopened).toEqual(original);
  });

  it.each(['anthropic', 'openai', 'kimi'])('adds Gemini defaults to a three-provider library while preserving %s as active', (activeProvider) => {
    const previous = {
      anthropic: { model: 'claude-custom', anthropicWorkspaceId: 'wrkspc_saved' },
      openai: { model: 'gpt-custom' }, kimi: { model: 'kimi-custom' },
    };
    const settings = readAiSettings(reader({ activeProvider, providers: JSON.stringify(previous) }));
    expect(settings.activeProvider).toBe(activeProvider);
    expect(settings.providers).toEqual({ ...previous, gemini: { model: 'gemini-3.8-flash' } });
    const restarted = readAiSettings(reader({ activeProvider, providers: JSON.stringify(settings.providers) }));
    expect(restarted).toEqual(settings);
  });

  it('preserves Gemini as the selected provider after reopening settings', () => {
    const settings = readAiSettings(reader({ activeProvider: 'gemini', providers: JSON.stringify({ gemini: { model: 'gemini-custom' } }) }));
    expect(settings.activeProvider).toBe('gemini');
    expect(settings.providers.gemini.model).toBe('gemini-custom');
  });

  it('rejects invalid saved settings without silently selecting another provider', () => {
    expect(() => readAiSettings(reader({ activeProvider: 'unknown' }))).toThrow('supported AI provider');
    expect(() => readAiSettings(reader({ providers: '{invalid' }))).toThrow('could not read');
    expect(() => readAiSettings(reader({ providers: 'null' }))).toThrow('could not read');
  });
});

describe('provider configuration validation', () => {
  it('accepts advanced model IDs and normalizes whitespace', () => {
    expect(validateProviderConfig('openai', { model: '  ft:gpt-custom:org:model.v2  ' })).toEqual({ model: 'ft:gpt-custom:org:model.v2' });
    expect(validateProviderConfig('kimi', { model: 'kimi-k3' })).toEqual({ model: 'kimi-k3' });
    expect(validateProviderConfig('gemini', { model: ' gemini-3.8-flash ' })).toEqual({ model: 'gemini-3.8-flash' });
  });

  it('rejects blank or unsafe IDs and keeps workspace IDs Anthropic-specific', () => {
    expect(() => validateProviderConfig('openai', { model: ' ' })).toThrow('valid OpenAI API model ID');
    expect(() => validateProviderConfig('kimi', { model: 'bad\nmodel' })).toThrow('valid Kimi API model ID');
    expect(() => validateProviderConfig('anthropic', { model: 'claude-sonnet-5', anthropicWorkspaceId: 'invalid' })).toThrow('workspace ID');
    expect(() => validateProviderConfig('openai', { model: 'gpt-custom', anthropicWorkspaceId: 'wrkspc_valid' })).toThrow('only to Anthropic');
    expect(() => validateProviderConfig('gemini', { model: '' })).toThrow('valid Gemini API model ID');
    expect(() => validateProviderConfig('gemini', { model: 'gemini-custom', anthropicWorkspaceId: 'wrkspc_valid' })).toThrow('only to Anthropic');
  });
});
