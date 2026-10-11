import { app } from 'electron';
import type { AppSettings, SaveSettingsInput, SetupInput } from '../shared/types';
import { AI_PROVIDERS, DEFAULT_MODELS, isAiProviderId, validateProviderConfig } from '../shared/config';
import { BackupService, localDateKey } from './backup/backup-service';
import { AiEvaluationService } from './ai/ai-evaluation-service';
import { LitRevoltDatabase } from './database/database';
import { PdfService } from './papers/pdf-service';
import { ReviewService } from './reviews/review-service';
import { CredentialStore } from './security/credentials';
import { StorageManager } from './settings/storage';
import { defaultProviderSettings, readAiSettings } from './settings/ai-settings';

export class AppServices {
  readonly storage: StorageManager;
  database: LitRevoltDatabase | null = null;
  credentials: CredentialStore | null = null;
  papers: PdfService | null = null;
  ai: AiEvaluationService | null = null;
  reviews: ReviewService | null = null;
  backups: BackupService | null = null;
  private startupError: Error | null = null;

  constructor() {
    this.storage = new StorageManager(app.getPath('userData'));
  }

  load(): void {
    try {
      const dataDirectory = this.storage.load();
      if (dataDirectory) this.openConfiguredServices();
      this.startupError = null;
    } catch (error) {
      this.close();
      this.startupError = error instanceof Error ? error : new Error(String(error));
      console.error('LitRevolt could not open the configured data library:', error);
    }
  }

  completeSetup(input: SetupInput): AppSettings {
    if (!input.privacyAccepted) throw new Error('Acknowledge the privacy notice to complete LitRevolt setup.');
    if (!input.dataDirectory.trim()) throw new Error('Choose a local data folder.');
    const provider = input.provider ?? 'anthropic';
    if (!isAiProviderId(provider)) throw new Error('Choose a supported AI provider.');
    const configuration = validateProviderConfig(provider, { model: input.model ?? DEFAULT_MODELS[provider] });
    this.close();
    this.startupError = null;
    this.storage.initialize(input.dataDirectory);
    this.openConfiguredServices();
    const db = this.requireDatabase();
    const { providers } = readAiSettings(db);
    providers[provider] = configuration;
    db.setSettings({ privacyAccepted: 'true', activeProvider: provider, providers: JSON.stringify(providers), theme: 'light', automaticBackups: 'true' });
    if (input.apiKey?.trim()) this.requireCredentials().saveApiKey(input.apiKey, provider);
    return this.getSettings();
  }

  getSettings(): AppSettings {
    if (this.startupError) {
      throw new Error('LitRevolt could not open its configured data library. Check that the data folder is available and writable, then restart LitRevolt.');
    }
    if (!this.database) {
      return {
        setupComplete: false,
        privacyAccepted: false,
        dataDirectory: '',
        activeProvider: 'anthropic',
        providers: {
          anthropic: { ...defaultProviderSettings().anthropic, apiKeyConfigured: false },
          openai: { ...defaultProviderSettings().openai, apiKeyConfigured: false },
          kimi: { ...defaultProviderSettings().kimi, apiKeyConfigured: false },
          gemini: { ...defaultProviderSettings().gemini, apiKeyConfigured: false },
        },
        theme: 'light',
        automaticBackups: true,
      };
    }
    const aiSettings = readAiSettings(this.database);
    const providers = Object.fromEntries(AI_PROVIDERS.map((provider) => [provider, {
      ...aiSettings.providers[provider], apiKeyConfigured: this.requireCredentials().hasApiKey(provider),
    }])) as AppSettings['providers'];
    return {
      setupComplete: true,
      privacyAccepted: this.database.getSetting('privacyAccepted') === 'true',
      dataDirectory: this.storage.root,
      activeProvider: aiSettings.activeProvider,
      providers,
      theme: (this.database.getSetting('theme', 'light') as AppSettings['theme']),
      automaticBackups: this.database.getSetting('automaticBackups', 'true') === 'true',
    };
  }

  saveSettings(input: SaveSettingsInput): AppSettings {
    const db = this.requireDatabase();
    const current = readAiSettings(db);
    const updates: Record<string, string> = {};
    // Validate the complete change before making any persistent writes.
    if (input.activeProvider !== undefined) {
      if (!isAiProviderId(input.activeProvider)) throw new Error('Choose a supported AI provider.');
      updates.activeProvider = input.activeProvider;
    }
    if (input.providers !== undefined) {
      for (const [provider, configuration] of Object.entries(input.providers)) {
        if (!isAiProviderId(provider)) throw new Error('Choose a supported AI provider.');
        if (!configuration) throw new Error('Enter a valid AI provider configuration.');
        current.providers[provider] = validateProviderConfig(provider, configuration);
      }
      updates.providers = JSON.stringify(current.providers);
    }
    if (input.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(input.theme)) throw new Error('Invalid theme.');
      updates.theme = input.theme;
    }
    if (input.automaticBackups !== undefined) {
      if (typeof input.automaticBackups !== 'boolean') throw new Error('Invalid automatic backup setting.');
      updates.automaticBackups = String(input.automaticBackups);
    }
    db.setSettings(updates);
    return this.getSettings();
  }

  async runAutomaticBackup(): Promise<void> {
    if (!this.database || !this.backups || !this.getSettings().automaticBackups) return;
    const today = localDateKey();
    if (this.database.getSetting('lastAutomaticBackup') === today) return;
    await this.backups.create();
    this.database.setSetting('lastAutomaticBackup', today);
  }

  requireDatabase(): LitRevoltDatabase {
    if (!this.database) throw new Error('Complete LitRevolt setup first.');
    return this.database;
  }
  requireCredentials(): CredentialStore {
    if (!this.credentials) throw new Error('Complete LitRevolt setup first.');
    return this.credentials;
  }
  requirePapers(): PdfService {
    if (!this.papers) throw new Error('Complete LitRevolt setup first.');
    return this.papers;
  }
  requireAi(): AiEvaluationService {
    if (!this.ai) throw new Error('Complete LitRevolt setup first.');
    return this.ai;
  }
  requireReviews(): ReviewService {
    if (!this.reviews) throw new Error('Complete LitRevolt setup first.');
    return this.reviews;
  }
  requireBackups(): BackupService {
    if (!this.backups) throw new Error('Complete LitRevolt setup first.');
    return this.backups;
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.credentials = null;
    this.papers = null;
    this.ai = null;
    this.reviews = null;
    this.backups = null;
  }

  private openConfiguredServices(): void {
    this.database = new LitRevoltDatabase(this.storage.databasePath);
    const aiSettings = readAiSettings(this.database);
    this.database.setSettings({ activeProvider: aiSettings.activeProvider, providers: JSON.stringify(aiSettings.providers) });
    this.credentials = new CredentialStore(this.storage.configPath);
    this.papers = new PdfService(this.database, this.storage);
    this.ai = new AiEvaluationService(this.credentials, this.database, this.storage);
    this.reviews = new ReviewService(this.database, this.ai);
    this.backups = new BackupService(this.database, this.storage);
  }
}
