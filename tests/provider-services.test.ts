import { describe, expect, it, vi } from 'vitest';
import { AppServices } from '../src/main/services';
import { defaultProviderSettings } from '../src/main/settings/ai-settings';

vi.mock('electron', () => ({ app: {}, safeStorage: {} }));
vi.mock('../src/main/ai/ai-evaluation-service', () => ({ AiEvaluationService: vi.fn() }));

function makeServices() {
  const values: Record<string, string> = {
    activeProvider: 'anthropic', providers: JSON.stringify(defaultProviderSettings()), privacyAccepted: 'true',
  };
  const setSettings = vi.fn((updates: Record<string, string>) => Object.assign(values, updates));
  const services = Object.assign(Object.create(AppServices.prototype) as AppServices, {
    database: { getSetting: (key: string, fallback = '') => values[key] ?? fallback, setSettings },
    credentials: { hasApiKey: (provider: string) => provider === 'openai' },
    storage: { root: '/local-library' },
  });
  return { values, services, setSettings };
}

describe('provider settings saves', () => {
  it('exposes Gemini defaults before setup without reading any credential', () => {
    const services = Object.assign(Object.create(AppServices.prototype) as AppServices, { database: null });
    expect(services.getSettings().providers.gemini).toEqual({ model: 'gemini-3.8-flash', apiKeyConfigured: false });
    expect(services.getSettings().activeProvider).toBe('anthropic');
  });

  it('validates the entire change before saving any preference', () => {
    const { services, values, setSettings } = makeServices();
    const previous = { ...values };
    expect(() => services.saveSettings({
      activeProvider: 'openai', providers: { openai: { model: 'gpt-custom' }, kimi: { model: '' } }, theme: 'dark',
    })).toThrow('valid Kimi');
    expect(setSettings).not.toHaveBeenCalled();
    expect(values).toEqual(previous);
  });

  it('commits a provider switch and related changes in one database transaction', () => {
    const { services, setSettings } = makeServices();
    const settings = services.saveSettings({ activeProvider: 'openai', providers: { openai: { model: ' gpt-custom ' } }, theme: 'dark' });
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(settings.activeProvider).toBe('openai');
    expect(settings.providers.openai).toEqual({ model: 'gpt-custom', apiKeyConfigured: true });
    expect(settings.providers.anthropic.model).toBe(defaultProviderSettings().anthropic.model);
    expect(settings.providers.kimi.apiKeyConfigured).toBe(false);
    expect(settings.theme).toBe('dark');
  });

  it('preserves other providers when updating a single provider', () => {
    const { services } = makeServices();
    services.saveSettings({ providers: { anthropic: { model: 'claude-custom', anthropicWorkspaceId: 'wrkspc_custom' } } });
    const settings = services.saveSettings({ activeProvider: 'kimi', providers: { kimi: { model: 'kimi-custom' } } });
    expect(settings.providers.anthropic).toEqual({ model: 'claude-custom', anthropicWorkspaceId: 'wrkspc_custom', apiKeyConfigured: false });
    expect(settings.providers.kimi.model).toBe('kimi-custom');
    expect(settings.providers.openai.model).toBe(defaultProviderSettings().openai.model);
  });

  it('saves Gemini preferences without losing existing models or configured status', () => {
    const { services, values } = makeServices();
    const existing = { anthropic: { model: 'claude-custom', anthropicWorkspaceId: 'wrkspc_saved' }, openai: { model: 'gpt-custom' }, kimi: { model: 'kimi-custom' } };
    values.providers = JSON.stringify(existing);
    values.activeProvider = 'openai';
    const before = services.getSettings();
    expect(before.activeProvider).toBe('openai');
    expect(before.providers.gemini).toEqual({ model: 'gemini-3.8-flash', apiKeyConfigured: false });
    const updated = services.saveSettings({ activeProvider: 'gemini', providers: { gemini: { model: 'gemini-custom' } } });
    expect(updated.activeProvider).toBe('gemini');
    expect(updated.providers.gemini).toEqual({ model: 'gemini-custom', apiKeyConfigured: false });
    expect(updated.providers.openai).toEqual({ model: 'gpt-custom', apiKeyConfigured: true });
    expect(updated.providers.anthropic).toEqual({ ...existing.anthropic, apiKeyConfigured: false });
    expect(JSON.parse(values.providers)).toEqual({ ...existing, gemini: { model: 'gemini-custom' } });
  });

  it('rejects invalid Gemini settings before persisting any changes', () => {
    const { services, setSettings } = makeServices();
    expect(() => services.saveSettings({ activeProvider: 'gemini', providers: { gemini: { model: '' } }, theme: 'dark' })).toThrow('valid Gemini');
    expect(setSettings).not.toHaveBeenCalled();
  });
});
