import type { HighlightRect } from '../../shared/types';
import { MAX_HIGHLIGHT_RECTS } from '../../shared/highlights';

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function normalizeSelectedText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function selectionRectsToPageRects(page: RectLike, clientRects: Iterable<RectLike>): HighlightRect[] {
  if (page.width <= 0 || page.height <= 0) return [];
  const clipped = Array.from(clientRects).flatMap((rect) => {
    const left = Math.max(page.left, rect.left);
    const top = Math.max(page.top, rect.top);
    const right = Math.min(page.left + page.width, rect.left + rect.width);
    const bottom = Math.min(page.top + page.height, rect.top + rect.height);
    return right - left > 0.5 && bottom - top > 1 ? [{ left, top, width: right - left, height: bottom - top }] : [];
  }).sort((a, b) => a.top - b.top || a.left - b.left);

  const merged: RectLike[] = [];
  for (const rect of clipped) {
    const previous = merged.at(-1);
    if (previous) {
      const overlap = Math.min(previous.top + previous.height, rect.top + rect.height) - Math.max(previous.top, rect.top);
      const sameLine = overlap > Math.min(previous.height, rect.height) * 0.65;
      const gap = rect.left - (previous.left + previous.width);
      if (sameLine && gap >= -2 && gap <= Math.max(4, Math.min(previous.height, rect.height) * 0.6)) {
        const right = Math.max(previous.left + previous.width, rect.left + rect.width);
        const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
        previous.left = Math.min(previous.left, rect.left);
        previous.top = Math.min(previous.top, rect.top);
        previous.width = right - previous.left;
        previous.height = bottom - previous.top;
        continue;
      }
    }
    merged.push({ ...rect });
  }

  return merged.slice(0, MAX_HIGHLIGHT_RECTS).map((rect) => ({
    x: round((rect.left - page.left) / page.width),
    y: round((rect.top - page.top) / page.height),
    width: round(rect.width / page.width),
    height: round(rect.height / page.height),
  }));
}
