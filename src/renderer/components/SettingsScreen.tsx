import { useReducer, useState } from 'react';
import { DatabaseBackup, FolderLock, KeyRound, Save, ShieldCheck } from 'lucide-react';
import type { AiProviderId, AppSettings } from '../../shared/types';
import { AI_PROVIDERS, PROVIDER_LABELS } from '../../shared/config';
import { aiSettingsReducer, createAiSettingsDraft, hasPendingAiSettings, selectedAiSettingsUpdate } from '../ai-settings';
import { AiModelFields } from './AiModelFields';
import { GeminiPrivacyNotice } from './GeminiPrivacyNotice';
import { Badge, Button, Card, Field, PageHeader, Spinner } from './ui';

export function SettingsScreen({ settings, onSettings, notify }: { settings: AppSettings; onSettings(settings: AppSettings): void; notify(message: string, tone?: 'success' | 'error'): void }) {
  const [draft, dispatch] = useReducer(aiSettingsReducer, settings, createAiSettingsDraft);
  const [theme, setTheme] = useState(settings.theme);
  const [automaticBackups, setAutomaticBackups] = useState(settings.automaticBackups);
  const [busy, setBusy] = useState('');
  const { provider, providers, apiKey, connectionResult } = draft;
  const config = providers[provider];
  const label = PROVIDER_LABELS[provider];
  const keyConfigured = settings.providers[provider].apiKeyConfigured;
  const activeLabel = PROVIDER_LABELS[settings.activeProvider];
  const activeModel = settings.providers[settings.activeProvider].model;
  const pendingAiSettings = hasPendingAiSettings(draft, settings);
  const activationLabel = provider !== settings.activeProvider ? `Use ${label}` : 'Save AI settings';
  const locked = busy !== '';

  const guard = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setBusy(''); }
  };
  const saveGeneral = () => guard('settings', async () => {
    const value = await window.litrevolt.app.saveSettings({ activeProvider: provider, providers, theme, automaticBackups });
    onSettings(value); notify(`Settings saved. AI requests will use ${PROVIDER_LABELS[value.activeProvider]}.`);
  });
  const saveAi = () => guard('ai-settings', async () => {
    const value = await window.litrevolt.app.saveSettings(selectedAiSettingsUpdate(draft));
    onSettings(value); notify(`AI settings saved. AI requests will use ${PROVIDER_LABELS[value.activeProvider]} with ${value.providers[value.activeProvider].model}.`);
  });
  const saveKey = () => guard('key', async () => {
    await window.litrevolt.app.saveApiKey({ provider, apiKey });
    dispatch({ type: 'key', apiKey: '' });
    const value = await window.litrevolt.app.getSettings();
    onSettings(value); notify(`${label} key saved in your operating system credential vault. AI requests ${value.activeProvider === provider ? 'use' : 'still use'} ${PROVIDER_LABELS[value.activeProvider]}.${value.activeProvider !== provider ? ` Choose Use ${label} to activate it.` : ''}`);
  });
  const testKey = () => guard('test', async () => {
    try {
      const result = await window.litrevolt.app.testApiKey({ provider, ...config, apiKey: apiKey.trim() || undefined });
      dispatch({ type: 'tested', result });
    } catch (error) {
      dispatch({ type: 'tested', result: { ok: false, message: error instanceof Error ? error.message : String(error) } });
    }
  });
  const backup = () => guard('backup', async () => { const path = await window.litrevolt.app.createBackup(); notify(`Backup created: ${path}`); });

  return <div className="page settings-page">
    <PageHeader eyebrow="Local control" title="Settings" description="Choose where explicit AI requests go and manage your local library." />
    <div className="settings-grid">
      <Card className="settings-card settings-connection"><header><div className="settings-icon"><KeyRound /></div><div><h2>AI connection</h2><p>Currently active: {activeLabel} · {activeModel}.</p></div><Badge tone={keyConfigured ? 'success' : 'warning'}>{keyConfigured ? 'Key configured' : 'Key required'}</Badge></header>
        <Field label="AI provider" hint="Activate your selection below. Each provider has a separate key and model."><select value={provider} disabled={locked} onChange={(event) => dispatch({ type: 'provider', provider: event.target.value as AiProviderId })}>{AI_PROVIDERS.map((id) => <option value={id} key={id}>{PROVIDER_LABELS[id]}</option>)}</select></Field>
        <AiModelFields provider={provider} model={config.model} custom={draft.customModels[provider]} disabled={locked} onModel={(model) => dispatch({ type: 'config', config: { model } })} onCustom={(custom) => dispatch({ type: 'custom', custom })} />
        {provider === 'anthropic' && <Field label="Anthropic workspace ID (optional)" hint="For keys that need an explicit workspace. Find it in Claude Console → Settings → Workspaces. The connection test uses the value entered here."><input value={config.anthropicWorkspaceId ?? ''} disabled={locked} onChange={(event) => dispatch({ type: 'config', config: { anthropicWorkspaceId: event.target.value } })} placeholder="wrkspc_…" autoComplete="off" /></Field>}
        <Field label={`${label} API key`} hint="Saved in your operating system credential vault. Entered keys are cleared when you switch providers; saved keys stay separate."><input type="password" value={apiKey} disabled={locked} onChange={(event) => dispatch({ type: 'key', apiKey: event.target.value })} placeholder={keyConfigured ? 'Enter a replacement key' : `Enter your ${label} API key`} autoComplete="off" spellCheck={false} /></Field>
        <p className="muted connection-note">Testing uses the model, workspace, and key entered here (or this provider’s saved key). It sends a small synthetic visual/JSON request, never a user paper, and may incur API usage charges. A successful test checks connectivity, not grading quality.</p>
        <div className="form-actions"><Button variant="secondary" onClick={testKey} disabled={locked || !config.model.trim() || (!apiKey.trim() && !keyConfigured)}>{busy === 'test' ? <Spinner label="Testing" /> : <><ShieldCheck size={16} /> Test connection</>}</Button><Button onClick={saveKey} disabled={!apiKey.trim() || locked}>{busy === 'key' ? <Spinner label="Saving" /> : <><Save size={16} /> Save key</>}</Button></div>
        {connectionResult && <p className={connectionResult.ok ? 'connection-result' : 'form-error'} role={connectionResult.ok ? 'status' : 'alert'}>{connectionResult.message}</p>}
        {pendingAiSettings && <div className="data-note" role="status"><ShieldCheck size={18} /><span><strong>{provider !== settings.activeProvider ? `${label} is not active yet.` : 'AI settings have unsaved changes.'}</strong> AI requests still use {activeLabel} with {activeModel}. Choose <strong>{activationLabel}</strong> to apply the displayed provider and model. Saving a key or testing a connection does not activate these settings.</span></div>}
        <Button onClick={saveAi} disabled={locked || !pendingAiSettings || !config.model.trim()}>{busy === 'ai-settings' ? <Spinner label="Saving" /> : <><Save size={16} /> {activationLabel}</>}</Button>
        {apiKey.trim() && <p className="muted connection-note">The entered key is unsaved. Use Save key to keep it for future AI requests.</p>}
        <div className="data-note"><ShieldCheck size={18} /><span>{provider === 'kimi' ? 'Kimi receives images of every PDF page, page-numbered text, and your submitted answers or writing.' : `${label} receives the PDF, page-numbered text, and your submitted answers or writing.`} Requests go directly to {label}, under its terms and billing. Searchable text is required for evidence checks. LitRevolt never automatically switches providers after a failure.</span></div>
        {provider === 'gemini' && <GeminiPrivacyNotice />}
      </Card>
      <Card className="settings-card"><header><div className="settings-icon"><FolderLock /></div><div><h2>Local data</h2><p>Managed papers and review records live here.</p></div></header>
        <Field label="Data folder"><input readOnly value={settings.dataDirectory} /></Field>
        <div className="data-note"><FolderLock size={18} /><span>PDFs, notes, reviews, scores, and the <code>litrevolt.db</code> database remain local. Changing the folder after setup is intentionally disabled to avoid partial migrations.</span></div>
      </Card>
      <Card className="settings-card"><header><div className="settings-icon"><Save /></div><div><h2>Preferences</h2><p>Save the selected provider, model choices, and visual theme.</p></div></header>
        <Field label="Theme"><select value={theme} disabled={locked} onChange={(event) => setTheme(event.target.value as AppSettings['theme'])}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></Field>
        <label className="check-row compact"><input type="checkbox" checked={automaticBackups} disabled={locked} onChange={(event) => setAutomaticBackups(event.target.checked)} /><span>Create one automatic database backup per day LitRevolt is opened.</span></label>
        <Button onClick={saveGeneral} disabled={locked || AI_PROVIDERS.some((id) => !providers[id].model.trim())}>{busy === 'settings' ? <Spinner label="Saving" /> : <><Save size={16} /> Save preferences</>}</Button>
      </Card>
      <Card className="settings-card"><header><div className="settings-icon"><DatabaseBackup /></div><div><h2>Backups</h2><p>Create a consistent SQLite snapshot now.</p></div></header>
        <p className="muted">Backups are written to <code>backups/litrevolt-backup-YYYY-MM-DD-HHmmss.db</code> inside your selected data folder.</p>
        <Button variant="secondary" onClick={backup} disabled={locked}>{busy === 'backup' ? <Spinner label="Backing up" /> : <><DatabaseBackup size={16} /> Create backup</>}</Button>
      </Card>
    </div>
  </div>;
}
