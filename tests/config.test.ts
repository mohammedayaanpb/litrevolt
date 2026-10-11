import { describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_MODEL, LEGACY_DEFAULT_CLAUDE_MODELS } from '../src/shared/config';

describe('Claude model defaults', () => {
  it('uses an active model and migrates the retired bundled default', () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-5');
    expect(LEGACY_DEFAULT_CLAUDE_MODELS.has('claude-sonnet-4-20250514')).toBe(true);
    expect(LEGACY_DEFAULT_CLAUDE_MODELS.has(DEFAULT_CLAUDE_MODEL)).toBe(false);
  });
});
