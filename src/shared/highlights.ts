import type { HighlightRect } from './types';

export const MAX_HIGHLIGHT_RECTS = 250;

export function isValidHighlightRect(value: unknown): value is HighlightRect {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Record<string, unknown>;
  const numbers = [rect.x, rect.y, rect.width, rect.height];
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return false;
  const { x, y, width, height } = rect as unknown as HighlightRect;
  return x >= 0 && y >= 0 && width > 0 && height > 0
    && x <= 1 && y <= 1 && x + width <= 1.000001 && y + height <= 1.000001;
}

export function readHighlightRects(value: unknown): HighlightRect[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidHighlightRect).slice(0, MAX_HIGHLIGHT_RECTS);
}
