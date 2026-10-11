const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

const SAFE_USER_MESSAGES: RegExp[] = [
  /^(?:Paper|Project|Review|Annotation) not found\.$/,
  /^Complete LitRevolt setup first\.$/,
  /^Acknowledge the privacy notice/,
  /^Choose a local data folder\.$/,
  /^Project name is required\.$/,
  /^Review name is required\.$/,
  /^Review name must be 200 characters or fewer\.$/,
  /^Paper title is required\.$/,
  /^Assign this paper to the selected project/,
  /^Page \d+ is outside this \d+-page PDF\.$/,
  /^This review does not belong/,
  /^An annotation cannot be moved/,
  /^The selected file is not a valid PDF\.$/,
  /^The selected PDF is too large/,
  /^AI review is unavailable/,
  /^AI (?:returned|could not evaluate|connection check failed)/,
  /^Choose a supported AI provider/,
  /^Workspace IDs apply only to Anthropic\.$/,
  /^Enter a valid (?:Anthropic|OpenAI|Kimi|Gemini) API model ID\.$/,
  /^Add your (?:OpenAI|Kimi|Gemini) API key/,
  /^Enter (?:an? )?(?:OpenAI|Kimi|Gemini|Anthropic) API key\.$/,
  /^LitRevolt could not save the API key in your operating system credential vault\.$/,
  /^Add your Anthropic API key/,
  /^Enter an Anthropic API key\.$/,
  /^Enter a valid Claude API model ID\.$/,
  /^Enter a valid Anthropic workspace ID/,
  /^Secure OS credential/,
  /^LitRevolt could not decrypt the stored API key/,
  /^LitRevolt (?:could not read|could not open|could not load|could not process)/,
  /^LitRevolt’s (?:saved|configured)/,
  /^LitRevolt only opens secure web links\.$/,
  /^LitRevolt refused to send a file outside/,
  /^Refusing to access a PDF outside/,
  /^Pass \d is (?:locked|already complete)/,
  /^This pass is still locked\.$/,
  /^Complete and submit the closed-book quiz/,
  /^Generate this pass quiz first\.$/,
  /^This quiz attempt has already been submitted\.$/,
  /^Answer every question/,
  /^Choose one of the provided answers/,
  /^The PDF is hidden until/,
  /^Finish the active closed-book quiz/,
  /^Complete all three passes/,
  /^Write at least \d+ characters/,
  /^This PDF is larger than/,
  /^Claude returned (?:an? )?(?:invalid|malformed|incomplete)/,
  /^Claude could not evaluate this request/,
];

const stripIpcPrefix = (value: string): string => value
  .replace(IPC_ERROR_PREFIX, '')
  .replace(/^Error:\s*/i, '')
  .trim();

export function userMessageForError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = stripIpcPrefix(raw);
  const lower = message.toLowerCase();

  if (message === 'This API key requires an Anthropic workspace ID. Enter it in Settings and test the connection again.'
    || message === 'Anthropic could not access the configured workspace. Check the workspace ID and your key’s access in Settings.') return message;

  // Provider adapters emit only these safe categories. Handle them before the
  // legacy Anthropic SDK translator so other providers keep their identity.
  if (/^(?:Anthropic|OpenAI|Kimi|Gemini) (?:rejected the API key\.|denied access to the selected model\.|requires available API credit\.|is temporarily |could not process this AI request\.|cannot fit )/.test(message)
    || /^The (?:Anthropic|OpenAI|Kimi|Gemini) request timed out\./.test(message)
    || /^The configured (?:Anthropic|OpenAI|Kimi|Gemini) model is unavailable\./.test(message)
    || /^LitRevolt could not reach (?:Anthropic|OpenAI|Kimi|Gemini)\./.test(message)) return message;

  if (/anthropic-workspace-id|not scoped to a workspace/i.test(message)) {
    return 'This API key requires an Anthropic workspace ID. Enter it in Settings, save preferences, and test the connection again.';
  }
  if (/workspace.*not found|not_found_error.*workspace/i.test(message)) {
    return 'Anthropic could not access the configured workspace. Check the workspace ID and your key’s access in Settings.';
  }
  if (/credit balance|insufficient.*(?:credit|balance)|billing.*(?:required|limit)/i.test(message)) {
    return 'Anthropic requires available API credit. Check billing in your Claude Console, then try again.';
  }

  if (/\b(?:401|authentication|invalid x-api-key|api key.*invalid)\b/i.test(message)) {
    return 'Anthropic rejected the API key. Verify it in Settings and try again.';
  }
  if (/\b(?:429|rate limit|overloaded)\b/i.test(message)) {
    return 'Anthropic is temporarily rate-limiting requests. Wait a moment and try again.';
  }
  if (/\b(?:500|502|503|504|529|internal_server_error|api_error)\b/i.test(message)) {
    return 'Anthropic is temporarily unable to process this request. Your submitted work is saved; try again shortly.';
  }
  if (/\b(?:timed out|timeout)\b/i.test(message)) {
    return 'The Anthropic request timed out. Your submitted work is saved; try again when the connection is stable.';
  }
  if (/\b(?:model.*not found|not_found_error|404).*claude|claude.*(?:model.*not found|not_found_error|404)/i.test(message)) {
    return 'The configured Claude model is unavailable. Choose a supported model in Settings.';
  }
  if (/\b(?:fetch failed|network|connection error|econnreset|enotfound|etimedout)\b/i.test(message)) {
    return 'LitRevolt could not reach Anthropic. Check your network connection and try again.';
  }
  if (SAFE_USER_MESSAGES.some((pattern) => pattern.test(message))) return message;

  const containsInternalDetail = /(?:[A-Za-z]:\\|\bapp\.asar\b|\bnode_modules\b|\b\.vite\b|Cannot find module|\n\s*at\s|SQLITE_|ZodError)/i.test(message);
  if (!message || containsInternalDetail || lower === '[object object]') return fallback;
  return fallback;
}
