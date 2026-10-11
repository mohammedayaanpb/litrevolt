import type { ReviewStatus, ReviewSummary } from '../shared/types';

export interface ReviewsViewState {
  query: string;
  projectId: string;
  status: 'all' | ReviewStatus;
  sort: 'updated' | 'created' | 'name';
}

export const DEFAULT_REVIEWS_VIEW: ReviewsViewState = {
  query: '', projectId: 'all', status: 'all', sort: 'updated',
};

export function selectReviews(reviews: ReviewSummary[], view: ReviewsViewState): ReviewSummary[] {
  const terms = view.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return reviews.filter(review => {
    const matchesProject = view.projectId === 'all' || (view.projectId === 'general'
      ? review.projectId === null : review.projectId === view.projectId);
    const text = `${review.name} ${review.paperTitle} ${review.projectName ?? 'General library'}`.toLocaleLowerCase();
    return matchesProject && (view.status === 'all' || view.status === review.status)
      && terms.every(term => text.includes(term));
  }).sort((a, b) => {
    if (view.sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true }) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    const dateOrder = view.sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt);
    return dateOrder || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}
