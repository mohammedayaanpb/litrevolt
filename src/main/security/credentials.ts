import fs from 'node:fs';
import path from 'node:path';
import { Entry } from '@napi-rs/keyring';
import { safeStorage } from 'electron';
import type { AiProviderId } from '../../shared/types';
import { isAiProviderId, PROVIDER_LABELS } from '../../shared/config';

const KEYRING_SERVICE = 'org.litrevolt.app';
const ENVIRONMENT_KEYS: Record<AiProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'], openai: ['OPENAI_API_KEY'], kimi: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'], gemini: ['GEMINI_API_KEY'],
};

interface LegacyEncryptedConfig {
  version: 1;
  apiKey: string;
}

interface KeyringConfig {
  version: 2;
  storage: 'os-keyring';
}

export interface SystemCredential {
  getPassword(): string | null;
  setPassword(password: string): void;
}

export class CredentialStore {
  private readonly credentials: Partial<Record<AiProviderId, SystemCredential>>;

  constructor(
    private readonly configPath: string,
    credential?: SystemCredential | Partial<Record<AiProviderId, SystemCredential>>,
  ) {
    this.credentials = credential && 'getPassword' in credential ? { anthropic: credential } : { ...credential };
  }

  hasApiKey(provider: AiProviderId = 'anthropic'): boolean {
    if (this.environmentKey(provider)) return true;
    try {
      return Boolean(this.readStoredApiKey(provider));
    } catch {
      return false;
    }
  }

  saveApiKey(apiKey: string, provider: AiProviderId = 'anthropic'): void {
    this.assertProvider(provider);
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error(`Enter a ${PROVIDER_LABELS[provider]} API key.`);

    try {
      this.credentialFor(provider).setPassword(trimmed);
      // A different provider must never destroy an Anthropic key awaiting migration.
      if (provider === 'anthropic' || !this.hasLegacyCredential()) this.writeKeyringMarker();
    } catch {
      throw new Error('LitRevolt could not save the API key in your operating system credential vault.');
    }
  }

  getApiKey(provider: AiProviderId = 'anthropic'): string {
    const environmentKey = this.environmentKey(provider);
    if (environmentKey) return environmentKey;

    try {
      const value = this.readStoredApiKey(provider);
      if (value) return value;
    } catch {
      throw new Error('LitRevolt could not read the API key from your operating system credential vault. Save it again in Settings.');
    }

    throw new Error(`Add your ${PROVIDER_LABELS[provider]} API key in LitRevolt Settings before using AI features.`);
  }

  private assertProvider(provider: AiProviderId): void {
    if (!isAiProviderId(provider)) throw new Error('Choose a supported AI provider.');
  }

  private credentialFor(provider: AiProviderId): SystemCredential {
    this.assertProvider(provider);
    return this.credentials[provider] ??= new Entry(KEYRING_SERVICE, `${provider}-api-key`);
  }

  private environmentKey(provider: AiProviderId): string | undefined {
    this.assertProvider(provider);
    for (const name of ENVIRONMENT_KEYS[provider]) {
      const value = process.env[name]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  private readStoredApiKey(provider: AiProviderId): string | null {
    const keyringValue = this.credentialFor(provider).getPassword()?.trim();
    if (keyringValue) return keyringValue;
    return provider === 'anthropic' ? this.migrateLegacyCredential() : null;
  }

  private hasLegacyCredential(): boolean {
    if (!fs.existsSync(this.configPath)) return false;
    const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as { version?: number };
    return config.version === 1;
  }

  private migrateLegacyCredential(): string | null {
    if (!fs.existsSync(this.configPath)) return null;

    const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<LegacyEncryptedConfig | KeyringConfig>;
    if (config.version === 2) return null;
    if (config.version !== 1 || typeof config.apiKey !== 'string' || !config.apiKey) return null;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Legacy credential decryption is unavailable.');
    }

    const value = safeStorage.decryptString(Buffer.from(config.apiKey, 'base64')).trim();
    if (!value) return null;

    this.credentialFor('anthropic').setPassword(value);
    this.writeKeyringMarker();
    return value;
  }

  private writeKeyringMarker(): void {
    const marker: KeyringConfig = { version: 2, storage: 'os-keyring' };
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(marker), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.configPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}
