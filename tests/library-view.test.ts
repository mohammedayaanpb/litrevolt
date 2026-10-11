import { describe, expect, it } from 'vitest';
import type { Paper } from '../src/shared/types';
import { DEFAULT_LIBRARY_VIEW, selectPapers } from '../src/renderer/library-view';

const papers: Paper[] = [
  { id: 'a', title: 'Underwater Vision', authors: 'Smith', year: '2024', createdAt: '2026-01-01', projectIds: ['ocean'], reviewCount: 1 },
  { id: 'b', title: 'Active Planning', authors: 'Lee', year: '', createdAt: '2026-03-01', projectIds: [], reviewCount: 0 },
  { id: 'c', title: 'Robotic Vision', authors: 'Smith', year: '2025', createdAt: '2026-02-01', projectIds: ['ocean'], reviewCount: 0 },
] as Paper[];

describe('library browsing', () => {
  it('combines case-insensitive search terms across metadata with project and review filters', () => {
    expect(selectPapers(papers, { ...DEFAULT_LIBRARY_VIEW, query: '  SMITH   vision ', projectId: 'ocean', status: 'unread' }).map(p => p.id)).toEqual(['c']);
  });
  it('finds unfiled papers and preserves the original library order', () => {
    expect(selectPapers(papers, { ...DEFAULT_LIBRARY_VIEW, projectId: 'unfiled' }).map(p => p.id)).toEqual(['b']);
    expect(papers.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('sorts dates and puts unknown publication years last', () => {
    expect(selectPapers(papers, DEFAULT_LIBRARY_VIEW).map(p => p.id)).toEqual(['b', 'c', 'a']);
    expect(selectPapers(papers, { ...DEFAULT_LIBRARY_VIEW, sort: 'oldest' }).map(p => p.id)).toEqual(['a', 'c', 'b']);
    expect(selectPapers(papers, { ...DEFAULT_LIBRARY_VIEW, sort: 'year' }).map(p => p.id)).toEqual(['c', 'a', 'b']);
  });
});
