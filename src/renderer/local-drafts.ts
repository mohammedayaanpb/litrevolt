export type DraftValue = string | Record<string, string>;
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const DRAFT_PREFIX = 'litrevolt:draft:v1:';

export function draftKey(reviewId: string, section: string, paperId: string): string {
  return `${DRAFT_PREFIX}${JSON.stringify([reviewId, section, paperId])}`;
}

export function draftsEqual(left: DraftValue, right: DraftValue): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function isDraftValue(value: unknown, fallback: DraftValue): value is DraftValue {
  if (typeof fallback === 'string') return typeof value === 'string';
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === 'string');
}

export function readLocalDraft<T extends DraftValue>(key: string, fallback: T, storage?: DraftStorage): T {
  try {
    const raw = (storage ?? window.localStorage).getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1 || !('value' in parsed)) return fallback;
    return isDraftValue(parsed.value, fallback) ? parsed.value as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalDraft(key: string, value: DraftValue, storage?: DraftStorage): boolean {
  try {
    (storage ?? window.localStorage).setItem(key, JSON.stringify({ version: 1, value }));
    return true;
  } catch {
    return false;
  }
}

// A save may finish after another edit. Only remove the snapshot that was saved.
export function clearMatchingDraft(key: string, saved: DraftValue, storage?: DraftStorage): void {
  try {
    const target = storage ?? window.localStorage;
    if (draftsEqual(readLocalDraft(key, saved, target), saved)) target.removeItem(key);
  } catch {
    // The review save already succeeded; unavailable local storage must not undo it.
  }
}

function clearScopedDrafts(scopeIndex: 0 | 2, scopeId: string, storage?: DraftStorage): boolean {
  try {
    const target = storage ?? window.localStorage;
    const matchingKeys: string[] = [];
    // Collect first: removing entries while walking Storage changes its indexes.
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      try {
        const scope: unknown = JSON.parse(key.slice(DRAFT_PREFIX.length));
        if (Array.isArray(scope) && scope.length === 3 && scope.every((part) => typeof part === 'string') && scope[scopeIndex] === scopeId) matchingKeys.push(key);
      } catch {
        // An unrelated or malformed key cannot safely be attributed to this scope.
      }
    }
    let complete = true;
    for (const key of matchingKeys) {
      try {
        target.removeItem(key);
        if (target.getItem(key) !== null) complete = false;
      } catch {
        complete = false;
      }
    }
    return complete;
  } catch {
    return false;
  }
}

export function clearPaperDrafts(paperId: string, storage?: DraftStorage): boolean {
  return clearScopedDrafts(2, paperId, storage);
}

export function clearReviewDrafts(reviewId: string, storage?: DraftStorage): boolean {
  return clearScopedDrafts(0, reviewId, storage);
}
