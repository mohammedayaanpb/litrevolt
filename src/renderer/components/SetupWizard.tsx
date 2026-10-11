import { useReducer, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderOpen, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { AiProviderId, AppSettings } from '../../shared/types';
import { AI_PROVIDERS, DEFAULT_MODELS, PROVIDER_LABELS } from '../../shared/config';
import { aiSettingsReducer, createAiSettingsDraft } from '../ai-settings';
import { AiModelFields } from './AiModelFields';
import { GeminiPrivacyNotice } from './GeminiPrivacyNotice';
import iconUrl from '../../../assets/branding/litrevolt-icon.svg';
import { Button, Field, Spinner } from './ui';

export function SetupWizard({ onComplete }: { onComplete(settings: AppSettings): Promise<void> }) {
  const [step, setStep] = useState(0);
  const [dataDirectory, setDataDirectory] = useState('');
  const [draft, dispatch] = useReducer(aiSettingsReducer, { activeProvider: 'anthropic', providers: {
    anthropic: { model: DEFAULT_MODELS.anthropic, apiKeyConfigured: false },
    openai: { model: DEFAULT_MODELS.openai, apiKeyConfigured: false },
    kimi: { model: DEFAULT_MODELS.kimi, apiKeyConfigured: false },
    gemini: { model: DEFAULT_MODELS.gemini, apiKeyConfigured: false },
  } }, createAiSettingsDraft);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const chooseFolder = async () => {
    setError('');
    try {
      const value = await window.litrevolt.app.chooseDataDirectory();
      if (value) setDataDirectory(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const finish = async () => {
    setBusy(true); setError('');
    try {
      const settings = await window.litrevolt.app.completeSetup({ dataDirectory, privacyAccepted: accepted, provider: draft.provider, model: draft.providers[draft.provider].model, apiKey: draft.apiKey.trim() || undefined });
      await onComplete(settings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  return (
    <div className="setup-shell">
      <div className="setup-orbit setup-orbit-one" />
      <div className="setup-orbit setup-orbit-two" />
      <section className="setup-card">
        <div className="setup-progress" aria-label={`Setup step ${step + 1} of 3`}>
          {[0, 1, 2].map((value) => <span key={value} className={value <= step ? 'active' : ''}>{value < step ? <Check size={13} /> : value + 1}</span>)}
        </div>
        {step === 0 && (
          <div className="setup-step welcome-step">
            <img src={iconUrl} alt="" className="setup-icon" />
            <span className="eyebrow">A three-pass research paper reader</span>
            <h1>Welcome to LitRevolt</h1>
            <p className="setup-tagline">Read deeper. Think critically. Review with purpose.</p>
            <p>LitRevolt guides you through a structured three-pass review of academic papers, tests your understanding, and evaluates your written summaries and critical analysis against the source paper.</p>
            <div className="setup-feature-row">
              <span><LockKeyhole size={18} /> Local-first</span>
              <span><ShieldCheck size={18} /> Your API key</span>
              <span><KeyRound size={18} /> Evidence-linked</span>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="setup-step privacy-step">
            <div className="setup-heading-icon"><ShieldCheck /></div>
            <span className="eyebrow">Privacy notice</span>
            <h1>How LitRevolt handles your data</h1>
            <div className="privacy-copy">
              <p>LitRevolt stores its database and managed PDF copies locally in the data folder you select.</p>
              <p>For an explicit AI action, LitRevolt sends the paper and your submitted answers or writing directly to your selected provider: Anthropic, OpenAI, Kimi, or Gemini. Anthropic, OpenAI, and Gemini receive the PDF and page-numbered text; Kimi receives images of every page and the same text. Searchable text is required for evidence checks.</p>
              <p>The LitRevolt project operates no intermediary server and receives none of your papers, reviews, or keys. API usage is subject to the selected provider’s terms and billed to the account associated with your key. LitRevolt never automatically switches providers after a failure.</p>
            </div>
            <label className="check-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I understand and acknowledge how LitRevolt handles my data.</span></label>
          </div>
        )}
        {step === 2 && (
          <div className="setup-step storage-step">
            <div className="setup-heading-icon"><FolderOpen /></div>
            <span className="eyebrow">Local setup</span>
            <h1>Choose your research home</h1>
            <p>Your database, managed PDFs, non-secret configuration, and backups stay in this folder. Your API key stays in your operating system credential vault.</p>
            <Field label="LitRevolt data folder">
              <div className="input-action"><input readOnly value={dataDirectory} placeholder="Choose a folder…" /><Button variant="secondary" disabled={busy} onClick={chooseFolder}><FolderOpen size={17} /> Browse</Button></div>
            </Field>
            <Field label="AI provider" hint="You can change providers and test the connection later in Settings."><select value={draft.provider} disabled={busy} onChange={(event) => dispatch({ type: 'provider', provider: event.target.value as AiProviderId })}>{AI_PROVIDERS.map((id) => <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>)}</select></Field>
            {draft.provider === 'gemini' && <GeminiPrivacyNotice />}
            <AiModelFields provider={draft.provider} model={draft.providers[draft.provider].model} custom={draft.customModels[draft.provider]} disabled={busy} onModel={(model) => dispatch({ type: 'config', config: { model } })} onCustom={(custom) => dispatch({ type: 'custom', custom })} />
            <Field label={`${PROVIDER_LABELS[draft.provider]} API key`} hint="Optional now. Add it later in Settings. Saved in your operating system credential vault; cleared from this form when you switch providers.">
              <input type="password" value={draft.apiKey} disabled={busy} onChange={(event) => dispatch({ type: 'key', apiKey: event.target.value })} placeholder={`Enter your ${PROVIDER_LABELS[draft.provider]} API key`} autoComplete="off" spellCheck={false} />
            </Field>
            <div className="storage-preview">
              <code>litrevolt.db</code><code>config/litrevolt-config.enc</code><code>papers/</code><code>backups/</code>
            </div>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="setup-actions">
          {step > 0 ? <Button variant="ghost" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}><ArrowLeft size={17} /> Back</Button> : <span />}
          {step < 2
            ? <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !accepted}>Continue <ArrowRight size={17} /></Button>
            : <Button onClick={finish} disabled={!dataDirectory || !accepted || !draft.providers[draft.provider].model.trim() || busy}>{busy ? <Spinner label="Preparing library" /> : <>Open LitRevolt <ArrowRight size={17} /></>}</Button>}
        </footer>
      </section>
    </div>
  );
}
