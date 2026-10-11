import { describe, expect, it } from 'vitest';
import { clearMatchingDraft, clearPaperDrafts, clearReviewDrafts, draftKey, readLocalDraft, writeLocalDraft } from '../src/renderer/local-drafts';

function createStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('local review draft recovery', () => {
  it('recovers unsaved text after reopening without mixing reviews or writing tabs', () => {
    const storage = createStorage();
    const summary = draftKey('review-1', 'writing:summary', 'paper-1');
    expect(writeLocalDraft(summary, 'My unfinished synthesis', storage)).toBe(true);
    expect(readLocalDraft(summary, 'Earlier saved version', storage)).toBe('My unfinished synthesis');
    expect(readLocalDraft(draftKey('review-1', 'writing:critical-review', 'paper-1'), '', storage)).toBe('');
    expect(readLocalDraft(draftKey('review-2', 'writing:summary', 'paper-1'), '', storage)).toBe('');
  });

  it('keeps answers attached to their quiz attempt and leaves other drafts when submitted', () => {
    const storage = createStorage();
    const firstAttempt = draftKey('review-1', 'pass:1:attempt:first', 'paper-1');
    const nextAttempt = draftKey('review-1', 'pass:1:attempt:next', 'paper-1');
    const notes = draftKey('review-1', 'pass:1:notes', 'paper-1');
    writeLocalDraft(firstAttempt, { q1: 'An answer still being written' }, storage);
    writeLocalDraft(notes, { purpose: 'Reading notes' }, storage);
    expect(readLocalDraft(firstAttempt, {}, storage)).toEqual({ q1: 'An answer still being written' });
    expect(readLocalDraft(nextAttempt, {}, storage)).toEqual({});
    clearMatchingDraft(firstAttempt, { q1: 'An answer still being written' }, storage);
    expect(storage.getItem(firstAttempt)).toBeNull();
    expect(readLocalDraft(notes, {}, storage)).toEqual({ purpose: 'Reading notes' });
  });

  it('preserves edits typed while an earlier snapshot is being saved', () => {
    const storage = createStorage();
    const key = draftKey('review-1', 'writing:summary', 'paper-1');
    writeLocalDraft(key, 'First version', storage);
    writeLocalDraft(key, 'Newer work typed while saving', storage);
    clearMatchingDraft(key, 'First version', storage);
    expect(readLocalDraft(key, '', storage)).toBe('Newer work typed while saving');
    clearMatchingDraft(key, 'Newer work typed while saving', storage);
    expect(storage.getItem(key)).toBeNull();
  });

  it('falls back to the saved review for malformed drafts and reports unavailable storage', () => {
    const storage = createStorage();
    const key = draftKey('review-1', 'writing:summary', 'paper-1');
    storage.setItem(key, 'not-json');
    expect(readLocalDraft(key, 'Saved writing', storage)).toBe('Saved writing');
    storage.setItem(key, JSON.stringify({ version: 1, value: { wrong: 'shape' } }));
    expect(readLocalDraft(key, 'Saved writing', storage)).toBe('Saved writing');
    const unavailable = {
      get length(): number { throw new Error('Unavailable'); },
      key: () => { throw new Error('Unavailable'); },
      getItem: () => { throw new Error('Unavailable'); },
      setItem: () => { throw new Error('Full'); },
      removeItem: () => { throw new Error('Unavailable'); },
    };
    expect(readLocalDraft(key, 'Saved writing', unavailable)).toBe('Saved writing');
    expect(writeLocalDraft(key, 'Unsaved writing', unavailable)).toBe(false);
    expect(() => clearMatchingDraft(key, 'Saved writing', unavailable)).not.toThrow();
    expect(clearPaperDrafts('paper-1', unavailable)).toBe(false);
    expect(clearReviewDrafts('review-1', unavailable)).toBe(false);
  });

  it('clears all review drafts for one deleted paper while preserving other papers and unrelated storage', () => {
    const storage = createStorage();
    const summary = draftKey('review-1', 'writing:summary', 'paper-1');
    const notes = draftKey('review-2', 'pass:1:notes', 'paper-1');
    const answer = draftKey('review-2', 'pass:1:attempt:first', 'paper-1');
    const otherPaper = draftKey('review-3', 'writing:summary', 'paper-10');
    writeLocalDraft(summary, 'Synthesis', storage);
    writeLocalDraft(notes, { purpose: 'Notes' }, storage);
    writeLocalDraft(answer, { q1: 'Answer' }, storage);
    writeLocalDraft(otherPaper, 'Unrelated writing', storage);
    storage.setItem('other-app:["review-1","writing:summary","paper-1"]', 'Unrelated app');
    storage.setItem('litrevolt:draft:v1:not-json-paper-1', 'Malformed scope');

    expect(clearPaperDrafts('paper-1', storage)).toBe(true);
    expect(storage.getItem(summary)).toBeNull();
    expect(storage.getItem(notes)).toBeNull();
    expect(storage.getItem(answer)).toBeNull();
    expect(readLocalDraft(otherPaper, '', storage)).toBe('Unrelated writing');
    expect(storage.getItem('other-app:["review-1","writing:summary","paper-1"]')).toBe('Unrelated app');
    expect(storage.getItem('litrevolt:draft:v1:not-json-paper-1')).toBe('Malformed scope');
  });

  it('reports incomplete cleanup and still removes other matching drafts if one removal fails', () => {
    const storage = createStorage();
    const blocked = draftKey('review-1', 'writing:summary', 'paper-1');
    const removable = draftKey('review-1', 'writing:critical-review', 'paper-1');
    writeLocalDraft(blocked, 'Blocked', storage);
    writeLocalDraft(removable, 'Removable', storage);
    const partialStorage = {
      ...storage,
      get length() { return storage.length; },
      removeItem: (key: string) => {
        if (key === blocked) throw new Error('Storage unavailable');
        storage.removeItem(key);
      },
    };

    expect(clearPaperDrafts('paper-1', partialStorage)).toBe(false);
    expect(storage.getItem(blocked)).not.toBeNull();
    expect(storage.getItem(removable)).toBeNull();
  });

  it('clears only the deleted review across all sections, preserving other reviews of the same paper', () => {
    const storage = createStorage();
    const deletedKeys = [
      draftKey('review-1', 'writing:summary', 'paper-1'),
      draftKey('review-1', 'writing:critical-review', 'paper-1'),
      draftKey('review-1', 'pass:1:notes', 'paper-1'),
      draftKey('review-1', 'pass:1:attempt:first', 'paper-1'),
    ];
    const anotherReview = draftKey('review-10', 'writing:summary', 'paper-1');
    deletedKeys.forEach((key) => writeLocalDraft(key, 'Deleted review draft', storage));
    writeLocalDraft(anotherReview, 'Keep this review', storage);
    storage.setItem('other-app:review-1', 'Keep unrelated storage');
    storage.setItem('litrevolt:draft:v1:not-json-review-1', 'Keep malformed scope');
    storage.setItem('litrevolt:draft:v1:["review-1","wrong-shape"]', 'Keep invalid scope');

    expect(clearReviewDrafts('review-1', storage)).toBe(true);
    deletedKeys.forEach((key) => expect(storage.getItem(key)).toBeNull());
    expect(readLocalDraft(anotherReview, '', storage)).toBe('Keep this review');
    expect(storage.length).toBe(4);
    expect(clearReviewDrafts('review-1', storage)).toBe(true);
  });

  it('continues review cleanup after a storage failure and reports that drafts remain', () => {
    const storage = createStorage();
    const blocked = draftKey('review-1', 'writing:summary', 'paper-1');
    const removable = draftKey('review-1', 'pass:1:notes', 'paper-1');
    writeLocalDraft(blocked, 'Keep until storage works', storage);
    writeLocalDraft(removable, { purpose: 'Remove these notes' }, storage);
    const partialStorage = {
      ...storage,
      get length() { return storage.length; },
      removeItem: (key: string) => { if (key !== blocked) storage.removeItem(key); },
    };
    expect(clearReviewDrafts('review-1', partialStorage)).toBe(false);
    expect(storage.getItem(blocked)).not.toBeNull();
    expect(storage.getItem(removable)).toBeNull();
  });
});
