import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SystemCredential } from '../src/main/security/credentials';
import { safeStorage } from 'electron';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  },
}));

class MemoryCredential implements SystemCredential {
  value: string | null = null;

  getPassword(): string | null {
    return this.value;
  }

  setPassword(password: string): void {
    this.value = password;
  }
}

const temporaryDirectories: string[] = [];

beforeEach(() => {
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) vi.stubEnv(key, '');
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  vi.mocked(safeStorage.decryptString).mockClear();
});

function makeConfigPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'litrevolt-credentials-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'config', 'litrevolt-config.enc');
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('CredentialStore', () => {
  it('persists the key in the system credential and writes only a non-secret marker', () => {
    const configPath = makeConfigPath();
    const credential = new MemoryCredential();
    const store = new CredentialStore(configPath, credential);

    store.saveApiKey('  sk-ant-test-secret  ');

    expect(credential.value).toBe('sk-ant-test-secret');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ version: 2, storage: 'os-keyring' });
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('sk-ant-test-secret');
    expect(new CredentialStore(configPath, credential).getApiKey()).toBe('sk-ant-test-secret');
  });

  it('does not report a configured key when a marker exists but the vault has no key', () => {
    const configPath = makeConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ version: 2, storage: 'os-keyring' }));
    const store = new CredentialStore(configPath, new MemoryCredential());

    expect(store.hasApiKey()).toBe(false);
    expect(() => store.getApiKey()).toThrow('Add your Anthropic API key in LitRevolt Settings');
  });

  it('keeps credentials isolated between providers and available after restart', () => {
    const configPath = makeConfigPath();
    const credentials = { anthropic: new MemoryCredential(), openai: new MemoryCredential(), kimi: new MemoryCredential(), gemini: new MemoryCredential() };
    const store = new CredentialStore(configPath, credentials);
    store.saveApiKey('anthropic-secret');
    store.saveApiKey('openai-secret', 'openai');
    store.saveApiKey('kimi-secret', 'kimi');
    store.saveApiKey('gemini-secret', 'gemini');
    const restarted = new CredentialStore(configPath, credentials);
    expect(restarted.getApiKey()).toBe('anthropic-secret');
    expect(restarted.getApiKey('openai')).toBe('openai-secret');
    expect(restarted.getApiKey('kimi')).toBe('kimi-secret');
    expect(restarted.getApiKey('gemini')).toBe('gemini-secret');
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('secret');
  });

  it('uses per-provider environment overrides without changing stored keys', () => {
    const credentials = { anthropic: new MemoryCredential(), openai: new MemoryCredential(), kimi: new MemoryCredential() };
    const store = new CredentialStore(makeConfigPath(), credentials);
    store.saveApiKey('stored-openai', 'openai');
    vi.stubEnv('OPENAI_API_KEY', ' environment-openai ');
    vi.stubEnv('MOONSHOT_API_KEY', 'environment-moonshot');
    expect(store.getApiKey('openai')).toBe('environment-openai');
    expect(store.hasApiKey()).toBe(false);
    expect(store.getApiKey('kimi')).toBe('environment-moonshot');
    vi.stubEnv('KIMI_API_KEY', 'environment-kimi');
    expect(store.getApiKey('kimi')).toBe('environment-kimi');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(store.getApiKey('openai')).toBe('stored-openai');
  });

  it('accepts only the explicit Gemini environment key and ignores ambient Google authentication', () => {
    const credential = new MemoryCredential();
    const store = new CredentialStore(makeConfigPath(), { gemini: credential });
    vi.stubEnv('GOOGLE_API_KEY', 'ambient-google-key');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/ambient/service-account.json');
    expect(store.hasApiKey('gemini')).toBe(false);
    expect(() => store.getApiKey('gemini')).toThrow('Add your Gemini API key');
    store.saveApiKey('stored-gemini', 'gemini');
    expect(store.getApiKey('gemini')).toBe('stored-gemini');
    vi.stubEnv('GEMINI_API_KEY', ' environment-gemini ');
    expect(store.getApiKey('gemini')).toBe('environment-gemini');
    expect(credential.value).toBe('stored-gemini');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(store.getApiKey('gemini')).toBe('stored-gemini');
  });

  it('preserves an unmigrated legacy key when saving another provider, then migrates only Anthropic', () => {
    const configPath = makeConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const legacy = JSON.stringify({ version: 1, apiKey: Buffer.from('legacy-anthropic-secret').toString('base64') });
    fs.writeFileSync(configPath, legacy);
    const credentials = { anthropic: new MemoryCredential(), openai: new MemoryCredential(), kimi: new MemoryCredential(), gemini: new MemoryCredential() };
    const store = new CredentialStore(configPath, credentials);
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    store.saveApiKey('openai-secret', 'openai');
    store.saveApiKey('kimi-secret', 'kimi');
    store.saveApiKey('gemini-secret', 'gemini');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(legacy);
    expect(store.getApiKey('openai')).toBe('openai-secret');
    expect(store.hasApiKey()).toBe(false);
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    expect(store.getApiKey()).toBe('legacy-anthropic-secret');
    expect(credentials.anthropic.value).toBe('legacy-anthropic-secret');
    expect(store.getApiKey('kimi')).toBe('kimi-secret');
    expect(store.getApiKey('gemini')).toBe('gemini-secret');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({ version: 2, storage: 'os-keyring' });
  });

  it('returns safe vault failures without including the underlying error or secret', () => {
    const credential: SystemCredential = {
      getPassword: () => { throw new Error('private read detail'); },
      setPassword: () => { throw new Error('private write detail'); },
    };
    const store = new CredentialStore(makeConfigPath(), { openai: credential });
    expect(store.hasApiKey('openai')).toBe(false);
    expect(() => store.getApiKey('openai')).toThrow('LitRevolt could not read the API key from your operating system credential vault. Save it again in Settings.');
    expect(() => store.saveApiKey('private-secret', 'openai')).toThrow('LitRevolt could not save the API key in your operating system credential vault.');
  });
});
