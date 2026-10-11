import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpc } from '../src/main/ipc/register-ipc';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({
  app: {}, dialog: {}, shell: {},
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
}));

function servicesMock() {
  const saveApiKey = vi.fn();
  const testConnection = vi.fn().mockResolvedValue(undefined);
  const saveSettings = vi.fn();
  const completeSetup = vi.fn();
  return {
    saveApiKey, testConnection, saveSettings, completeSetup,
    requireCredentials: () => ({ saveApiKey }),
    requireAi: () => ({ testConnection }),
  };
}

beforeEach(() => handlers.clear());

describe('provider IPC contracts', () => {
  it('accepts Gemini for setup, preferences, credential saves, and unsaved connection tests', async () => {
    const services = servicesMock();
    registerIpc(services as never);
    const setup = { dataDirectory: '/local-library', privacyAccepted: true, provider: 'gemini', model: 'gemini-3.8-flash' };
    handlers.get('app:complete-setup')!(null, setup);
    expect(services.completeSetup).toHaveBeenCalledWith(setup);
    const settings = { activeProvider: 'gemini', providers: { gemini: { model: 'gemini-custom' } } };
    handlers.get('app:save-settings')!(null, settings);
    expect(services.saveSettings).toHaveBeenCalledWith(settings);
    handlers.get('app:save-api-key')!(null, { provider: 'gemini', apiKey: ' gemini-key ' });
    expect(services.saveApiKey).toHaveBeenCalledExactlyOnceWith('gemini-key', 'gemini');
    const result = await handlers.get('app:test-api-key')!(null, { provider: 'gemini', model: ' gemini-custom ', apiKey: ' unsaved-gemini ' });
    expect(services.testConnection).toHaveBeenCalledWith({ provider: 'gemini', model: 'gemini-custom', apiKey: 'unsaved-gemini' });
    expect(result).toEqual({ ok: true, message: 'Connected to Gemini successfully with gemini-custom.' });
    expect(services.saveApiKey).toHaveBeenCalledTimes(1);
    expect(services.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('tests the exact unsaved configuration without saving settings or credentials', async () => {
    const services = servicesMock();
    registerIpc(services as never);
    const input = { provider: 'anthropic', model: ' claude-custom ', anthropicWorkspaceId: ' wrkspc_unsaved ', apiKey: ' unsaved-secret ' };
    const result = await handlers.get('app:test-api-key')!(null, input);
    expect(services.testConnection).toHaveBeenCalledWith({ provider: 'anthropic', model: 'claude-custom', anthropicWorkspaceId: 'wrkspc_unsaved', apiKey: 'unsaved-secret' });
    expect(result).toEqual({ ok: true, message: 'Connected to Anthropic successfully with claude-custom.' });
    expect(services.saveApiKey).not.toHaveBeenCalled();
    expect(services.saveSettings).not.toHaveBeenCalled();
  });

  it('uses the selected provider saved key when no unsaved key was entered', async () => {
    const services = servicesMock();
    registerIpc(services as never);
    await handlers.get('app:test-api-key')!(null, { provider: 'kimi', model: 'kimi-k3' });
    expect(services.testConnection).toHaveBeenCalledWith({ provider: 'kimi', model: 'kimi-k3' });
  });

  it('saves only the explicitly selected provider credential', () => {
    const services = servicesMock();
    registerIpc(services as never);
    handlers.get('app:save-api-key')!(null, { provider: 'openai', apiKey: ' openai-secret ' });
    expect(services.saveApiKey).toHaveBeenCalledExactlyOnceWith('openai-secret', 'openai');
  });

  it('rejects unknown providers, custom endpoints, and workspace IDs for other providers', async () => {
    const services = servicesMock();
    registerIpc(services as never);
    await expect(handlers.get('app:test-api-key')!(null, { provider: 'unknown', model: 'custom' })).rejects.toThrow();
    await expect(handlers.get('app:test-api-key')!(null, { provider: 'openai', model: 'custom', baseURL: 'https://untrusted.example' })).rejects.toThrow();
    await expect(handlers.get('app:test-api-key')!(null, { provider: 'openai', model: 'custom', anthropicWorkspaceId: 'wrkspc_example' })).rejects.toThrow('only to Anthropic');
    expect(services.testConnection).not.toHaveBeenCalled();
  });

  it('propagates a failed connection without reporting success or changing saved settings', async () => {
    const services = servicesMock();
    services.testConnection.mockRejectedValue(new Error('OpenAI rejected the API key.'));
    registerIpc(services as never);
    await expect(handlers.get('app:test-api-key')!(null, { provider: 'openai', model: 'gpt-custom' })).rejects.toThrow('OpenAI rejected');
    expect(services.saveSettings).not.toHaveBeenCalled();
  });
});
