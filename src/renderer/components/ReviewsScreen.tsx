import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpenCheck, CheckCircle2, Clock3, Search, X } from 'lucide-react';
import type { LibrarySnapshot, ReviewSummary } from '../../shared/types';
import { DEFAULT_REVIEWS_VIEW, selectReviews, type ReviewsViewState } from '../reviews-view';
import { ReviewList } from './ReviewList';
import { Button, EmptyState, IconButton, PageHeader, Spinner } from './ui';

export function ReviewsScreen({ library, view, onViewChange, onOpenReview, onLibrary, onRefresh, notify }: {
  library: LibrarySnapshot | null;
  view: ReviewsViewState;
  onViewChange(view: ReviewsViewState): void;
  onOpenReview(id: string): void;
  onLibrary(): void;
  onRefresh(): Promise<LibrarySnapshot>;
  notify(message: string, tone?: 'success' | 'error'): void;
}) {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const projects = library?.projects ?? [];
  const projectId = view.projectId === 'all' || view.projectId === 'general' || projects.some(project => project.id === view.projectId) ? view.projectId : 'all';
  const filteredReviews = useMemo(() => selectReviews(reviews ?? [], { ...view, projectId }), [reviews, view, projectId]);
  const update = (patch: Partial<ReviewsViewState>) => onViewChange({ ...view, ...patch });
  const filtered = Boolean(view.query.trim() || projectId !== 'all' || view.status !== 'all');
  const clearFilters = () => { onViewChange({ ...DEFAULT_REVIEWS_VIEW, sort: view.sort }); searchRef.current?.focus(); };

  useEffect(() => {
    let active = true;
    setLoadError('');
    window.litrevolt.reviews.list().then(value => { if (active) setReviews(value); })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [attempt]);

  const changed = async () => {
    await Promise.all([
      onRefresh(),
      window.litrevolt.reviews.list().then(setReviews),
    ]);
  };
  const count = reviews?.length ?? 0;
  const complete = reviews?.filter(review => review.status === 'complete').length ?? 0;
  const scopeName = projectId === 'all' ? 'All reviews' : projectId === 'general' ? 'General library' : projects.find(project => project.id === projectId)?.name;

  return <div className="page reviews-page">
    <PageHeader eyebrow="Your understanding, in progress" title="Reviews" description="Find your place, revisit your thinking, and keep every review organized."
      actions={<Button ref={browseRef} variant="secondary" onClick={onLibrary}>Browse papers <ArrowRight size={16} /></Button>} />
    {loadError ? <div className="reviews-load-error" role="alert"><h2>Reviews could not be loaded</h2><p>{loadError}</p><Button onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>
      : reviews === null ? <div className="reviews-loading" role="status"><Spinner label="Loading reviews" /></div>
      : count === 0 ? <EmptyState icon={<BookOpenCheck size={32} />} title="Make room for a deeper read" action={<Button onClick={onLibrary}>Choose a paper <ArrowRight size={16} /></Button>}>
        Open a paper in your library and start a review. Your reading passes, notes, and final critique will be easy to find here.
      </EmptyState> : <>
        <div className="reviews-overview" aria-label="Review totals">
          <div><BookOpenCheck size={20} /><span><strong>{count}</strong> total {count === 1 ? 'review' : 'reviews'}</span></div>
          <div><Clock3 size={20} /><span><strong>{count - complete}</strong> in progress</span></div>
          <div><CheckCircle2 size={20} /><span><strong>{complete}</strong> complete</span></div>
        </div>
        <section aria-label="Browse reviews">
          <div className="library-section-heading"><h2>{scopeName}</h2><span className="reviews-context-hint">Organized by the project each review belongs to</span></div>
          <div className="library-toolbar reviews-toolbar">
            <div className="search-input"><Search size={18} aria-hidden /><input ref={searchRef} value={view.query} aria-label="Search reviews" placeholder="Search review name, paper, or project" onChange={event => update({ query: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') update({ query: '' }); }} />
              {view.query && <IconButton label="Clear review search" onClick={() => { update({ query: '' }); searchRef.current?.focus(); }}><X size={15} /></IconButton>}
            </div>
            <select aria-label="Filter reviews by project" value={projectId} onChange={event => update({ projectId: event.target.value })}>
              <option value="all">All projects & general</option><option value="general">General library</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <select aria-label="Sort reviews" value={view.sort} onChange={event => update({ sort: event.target.value as ReviewsViewState['sort'] })}>
              <option value="updated">Recently updated</option><option value="created">Newest started</option><option value="name">Review name A–Z</option>
            </select>
          </div>
          <div className="library-filter-row">
            <div className="filter-chips" role="group" aria-label="Filter reviews by status">{([['all', 'All statuses'], ['in-progress', 'Reading'], ['writing', 'Writing'], ['complete', 'Complete']] as const).map(([status, label]) => <button key={status} aria-pressed={view.status === status} onClick={() => update({ status })}>{label}</button>)}</div>
            <span className="result-count" role="status">{filteredReviews.length} {filteredReviews.length === 1 ? 'review' : 'reviews'}{filtered ? ` of ${count}` : ''}</span>
            {filtered && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
          </div>
          {filteredReviews.length ? <ReviewList reviews={filteredReviews} onOpen={onOpenReview} onChanged={changed} onEmptyFocus={() => (searchRef.current ?? browseRef.current)?.focus({ preventScroll: true })} notify={notify} />
            : <EmptyState icon={<Search size={28} />} title="No reviews match" action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}>Try a different review name, project, or status to find your work.</EmptyState>}
        </section>
      </>}
  </div>;
}
