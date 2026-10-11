import { describe, expect, it } from 'vitest';
import { userMessageForError } from '../src/shared/errors';

describe('user-facing IPC errors', () => {
  it('preserves intentional application guidance', () => {
    const error = new Error("Error invoking remote method 'reviews:complete-pass': Error: Complete and submit the closed-book quiz before finishing this pass.");
    expect(userMessageForError(error, 'Fallback')).toBe('Complete and submit the closed-book quiz before finishing this pass.');
    expect(userMessageForError(new Error('Claude returned an incomplete response. Try again.'), 'Fallback'))
      .toBe('Claude returned an incomplete response. Try again.');
  });

  it('does not expose bundle names or absolute local paths', () => {
    const error = new Error("Error invoking remote method 'library:import-paper': Error: Cannot find module 'C:\\Users\\reader\\app.asar\\.vite\\build\\pdf.worker.mjs'");
    expect(userMessageForError(error, 'LitRevolt could not import this PDF.')).toBe('LitRevolt could not import this PDF.');
  });

  it('translates common Anthropic failures', () => {
    expect(userMessageForError(new Error('401 authentication_error: invalid x-api-key'), 'Fallback'))
      .toMatch(/rejected the API key/i);
    expect(userMessageForError(new Error('429 rate limit exceeded'), 'Fallback'))
      .toMatch(/rate-limiting/i);
  });

  it('explains workspace selection and billing failures without exposing SDK details', () => {
    expect(userMessageForError(new Error('400 This API key is not scoped to a workspace; include anthropic-workspace-id'), 'Fallback')).toMatch(/workspace ID.*Settings/);
    expect(userMessageForError(new Error('404 not_found_error: Workspace wrkspc_example not found.'), 'Fallback')).toMatch(/could not access the configured workspace/);
    expect(userMessageForError(new Error('400 Your credit balance is too low'), 'Fallback')).toMatch(/available API credit/);
  });

  it('distinguishes service failures, request timeouts, and connection errors', () => {
    expect(userMessageForError(new Error('500 internal_server_error: private request body'), 'Fallback')).toMatch(/temporarily unable/);
    expect(userMessageForError(new Error('Request timed out.'), 'Fallback')).toMatch(/timed out.*saved/);
    expect(userMessageForError(new Error('Connection error.'), 'Fallback')).toMatch(/could not reach Anthropic/);
  });
});
