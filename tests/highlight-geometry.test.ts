import { describe, expect, it } from 'vitest';
import { normalizeSelectedText, selectionRectsToPageRects } from '../src/renderer/pdf/highlight-geometry';

describe('PDF highlight geometry', () => {
  it('normalizes clipped client rectangles into zoom-independent page coordinates', () => {
    const page = { left: 100, top: 50, width: 400, height: 800 };
    const rects = selectionRectsToPageRects(page, [
      { left: 120, top: 100, width: 80, height: 20 },
      { left: 202, top: 100, width: 98, height: 20 },
      { left: 90, top: 140, width: 70, height: 20 },
    ]);

    expect(rects).toEqual([
      { x: 0.05, y: 0.0625, width: 0.45, height: 0.025 },
      { x: 0, y: 0.1125, width: 0.15, height: 0.025 },
    ]);
  });

  it('drops empty/outside rectangles and normalizes selected whitespace', () => {
    expect(selectionRectsToPageRects({ left: 0, top: 0, width: 100, height: 100 }, [
      { left: 150, top: 20, width: 10, height: 10 },
      { left: 10, top: 10, width: 0.2, height: 10 },
    ])).toEqual([]);
    expect(normalizeSelectedText('  A\n\n careful\tselection  ')).toBe('A careful selection');
  });
});
