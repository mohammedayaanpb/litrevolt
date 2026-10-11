import { describe, expect, it } from 'vitest';
import type { ReviewSummary } from '../src/shared/types';
import { DEFAULT_REVIEWS_VIEW, selectReviews } from '../src/renderer/reviews-view';

const review = (id: string, overrides: Partial<ReviewSummary>): ReviewSummary => ({
  id, name: `Review ${id}`, paperId: 'shared-paper', paperTitle: 'Underwater perception', projectId: null, projectName: null,
  status: 'in-progress', currentPass: 1, score: 0, createdAt: '2026-09-01', updatedAt: '2026-09-01', ...overrides,
});
const reviews = [
  review('1', { projectId: 'robotics', projectName: 'Robotics', name: 'Replication plan', updatedAt: '2026-09-03' }),
  review('2', { name: 'First reading', status: 'writing', updatedAt: '2026-09-02' }),
  review('3', { projectId: 'vision', projectName: 'Vision', status: 'complete', createdAt: '2026-09-03' }),
];

describe('review browsing', () => {
  it('filters by the review project, keeping general reviews of the same paper separate', () => {
    expect(selectReviews(reviews, { ...DEFAULT_REVIEWS_VIEW, projectId: 'robotics' }).map(r => r.id)).toEqual(['1']);
    expect(selectReviews(reviews, { ...DEFAULT_REVIEWS_VIEW, projectId: 'general' }).map(r => r.id)).toEqual(['2']);
  });
  it('combines metadata search, status, and project filters', () => {
    expect(selectReviews(reviews, { ...DEFAULT_REVIEWS_VIEW, query: '  PERCEPTION first ', status: 'writing', projectId: 'general' }).map(r => r.id)).toEqual(['2']);
    expect(selectReviews(reviews, { ...DEFAULT_REVIEWS_VIEW, query: 'robotics replication' }).map(r => r.id)).toEqual(['1']);
  });
  it('sorts without changing the source list and never applies the recent-review limit', () => {
    const all = Array.from({ length: 12 }, (_, i) => review(String(i + 1), {}));
    expect(selectReviews(all, { ...DEFAULT_REVIEWS_VIEW, sort: 'name' }).map(r => r.name)).toEqual(all.map(r => r.name));
    expect(selectReviews(reviews, { ...DEFAULT_REVIEWS_VIEW, sort: 'created' })[0].id).toBe('3');
    expect(selectReviews(reviews, DEFAULT_REVIEWS_VIEW).map(r => r.id)).toEqual(['1', '2', '3']);
    expect(reviews.map(r => r.id)).toEqual(['1', '2', '3']);
  });
});
