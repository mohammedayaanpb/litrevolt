import { DEFAULT_MODELS, PROVIDER_LABELS } from '../../shared/config';
import type { AiProviderId } from '../../shared/types';
import { Field } from './ui';

export function AiModelFields({ provider, model, custom, disabled, onModel, onCustom }: {
  provider: AiProviderId;
  model: string;
  custom: boolean;
  disabled: boolean;
  onModel(model: string): void;
  onCustom(custom: boolean): void;
}) {
  return <>
    <Field label={`${PROVIDER_LABELS[provider]} model`} hint="Model availability depends on your provider account. Use Test connection in Settings to check access.">
      <select value={custom ? 'custom' : 'default'} disabled={disabled} onChange={(event) => onCustom(event.target.value === 'custom')}>
        <option value="default">{DEFAULT_MODELS[provider]} (default)</option>
        <option value="custom">Custom model ID (advanced)</option>
      </select>
    </Field>
    {custom && <Field label="Custom model ID" hint="Use a model that accepts visual documents and produces structured JSON responses.">
      <input value={model} disabled={disabled} onChange={(event) => onModel(event.target.value)} placeholder={DEFAULT_MODELS[provider]} autoComplete="off" spellCheck={false} />
    </Field>}
  </>;
}
