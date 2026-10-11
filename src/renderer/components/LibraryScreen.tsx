import { useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Clock3, FileQuestion, Folder, LayoutGrid, List, Search, Upload, X } from 'lucide-react';
import type { LibrarySnapshot, Paper, Review } from '../../shared/types';
import { DEFAULT_LIBRARY_VIEW, selectPapers, type LibraryViewState } from '../library-view';
import { Badge, Button, EmptyState, IconButton, PageHeader, Spinner } from './ui';

export function LibraryScreen({ library, view, onViewChange, onOpenPaper, onOpenReview, onRefresh, notify }: {
  library: LibrarySnapshot | null;
  view: LibraryViewState;
  onViewChange(view: LibraryViewState): void;
  onOpenPaper(paper: Paper): void;
  onOpenReview(review: Pick<Review, 'id'>): void;
  onRefresh(): Promise<LibrarySnapshot>;
  notify(message: string, tone?: 'success' | 'error'): void;
}) {
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const projectId = view.projectId === 'all' || view.projectId === 'unfiled' || library?.projects.some(project => project.id === view.projectId) ? view.projectId : 'all';
  const papers = useMemo(() => selectPapers(library?.papers ?? [], { ...view, projectId }), [library, view, projectId]);
  const update = (patch: Partial<LibraryViewState>) => onViewChange({ ...view, ...patch });
  const filtered = Boolean(view.query.trim() || projectId !== 'all' || view.status !== 'all');
  const resetFilters = () => { onViewChange({ ...DEFAULT_LIBRARY_VIEW, layout: view.layout, sort: view.sort }); searchRef.current?.focus(); };
  const total = library?.papers.length ?? 0;
  const unfinished = (library?.recentReviews ?? []).filter(review => review.status !== 'complete');
  const recent = (unfinished.length ? unfinished : library?.recentReviews ?? []).slice(0, 2);
  const projectName = library?.projects.find(project => project.id === projectId)?.name;

  const importPaper = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.litrevolt.library.importPaper(projectId !== 'all' && projectId !== 'unfiled' ? projectId : undefined);
      if (result) {
        await onRefresh();
        notify(result.duplicate ? 'That PDF was already in your library.' : `Imported “${result.paper.title}”.`);
        onOpenPaper(result.paper);
      }
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setBusy(false); }
  };

  return <div className="page library-page">
    <PageHeader eyebrow="Your research workspace" title="Library" description="A place to read deeply, connect ideas, and make them your own."
      actions={<Button onClick={importPaper} disabled={busy}>{busy ? <Spinner label="Importing PDF" /> : <><Upload size={17} /> Import PDF</>}</Button>} />
    {total > 0 && <div className="library-overview"><span><BookOpen size={16} /> {total} {total === 1 ? 'paper' : 'papers'}</span><span><Folder size={16} /> {library?.projects.length ?? 0} {library?.projects.length === 1 ? 'project' : 'projects'}</span><span className="library-local">Stored on your computer</span></div>}
    {recent.length > 0 && <section className="resume-section" aria-label="Recent reviews">
      <div className="section-title"><h2>{unfinished.length ? 'Pick up where you left off' : 'Recent reviews'}</h2><p>{unfinished.length ? 'Your reading, notes, and next step are waiting.' : 'Revisit your understanding and evidence.'}</p></div>
      <div className="recent-list">{recent.map(review => <button key={review.id} onClick={() => onOpenReview(review)}>
        <span className="resume-icon"><Clock3 size={19} /></span><span className="recent-copy"><strong>{review.name}</strong><small>{review.paperTitle}</small><small>{review.status === 'writing' ? 'Continue synthesis & critique' : review.status === 'complete' ? 'View completed review' : 'Continue three-pass review'} · {new Date(review.updatedAt).toLocaleDateString()}</small></span>
        {review.status === 'complete' && <Badge tone="success">{review.score}/100</Badge>}<ArrowRight size={17} />
      </button>)}</div>
    </section>}
    {total === 0 && !projectName ? <>
      <EmptyState icon={<BookOpen size={32} />} title="Your next idea starts with a paper" action={<Button onClick={importPaper} disabled={busy}>{busy ? <Spinner label="Importing PDF" /> : <><Upload size={17} /> Import your first paper</>}</Button>}>
        Add a research PDF to read, annotate, and build your own understanding. You can begin reading without an API key.
      </EmptyState>
      <div className="reading-path" aria-label="The three-pass reading method">{[['01', 'Survey', 'Find the question and contribution.'], ['02', 'Understand', 'Trace the methods and evidence.'], ['03', 'Challenge', 'Reconstruct, critique, and connect.']].map(([number, title, text]) => <div key={number}><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
    </> : <section aria-label="Browse papers">
      <div className="library-section-heading"><h2>{projectName ?? (projectId === 'unfiled' ? 'General library' : 'Your papers')}</h2><div className="view-switch" role="group" aria-label="Paper layout"><button aria-label="Grid view" title="Grid view" aria-pressed={view.layout === 'grid'} onClick={() => update({ layout: 'grid' })}><LayoutGrid size={17} /></button><button aria-label="List view" title="List view" aria-pressed={view.layout === 'list'} onClick={() => update({ layout: 'list' })}><List size={18} /></button></div></div>
      <div className="library-toolbar">
        <div className="search-input"><Search size={18} aria-hidden /><input ref={searchRef} value={view.query} onChange={event => update({ query: event.target.value })} placeholder="Search title, author, or year" aria-label="Search papers" onKeyDown={event => { if (event.key === 'Escape') update({ query: '' }); }} />{view.query && <IconButton label="Clear search" onClick={() => { update({ query: '' }); searchRef.current?.focus(); }}><X size={15} /></IconButton>}</div>
        <select value={projectId} onChange={event => update({ projectId: event.target.value })} aria-label="Filter by project"><option value="all">All projects</option><option value="unfiled">General library</option>{library?.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <select value={view.sort} onChange={event => update({ sort: event.target.value as LibraryViewState['sort'] })} aria-label="Sort papers"><option value="newest">Recently added</option><option value="oldest">Oldest added</option><option value="title">Title A–Z</option><option value="year">Publication year</option></select>
      </div>
      <div className="library-filter-row"><div className="filter-chips" role="group" aria-label="Review status">{([['all', 'All papers'], ['unread', 'Not reviewed'], ['reviewed', 'With reviews']] as const).map(([status, label]) => <button key={status} aria-pressed={view.status === status} onClick={() => update({ status })}>{label}</button>)}</div><span className="result-count" role="status">{papers.length} {papers.length === 1 ? 'paper' : 'papers'}{filtered ? ` of ${total}` : ''}</span>{filtered && <Button variant="ghost" onClick={resetFilters}>Clear filters</Button>}</div>
      <div className={`paper-grid ${view.layout === 'list' ? 'paper-list' : ''}`}>
        {papers.map((paper, index) => {
          const names = paper.projectIds.map(id => library?.projects.find(project => project.id === id)?.name).filter(Boolean);
          return <button type="button" key={paper.id} className="card paper-card" onClick={() => onOpenPaper(paper)} aria-label={`Open ${paper.title}`}>
            <span className={`paper-spine spine-${index % 4}`} aria-hidden />
            <span className="paper-card-top"><Badge tone={paper.searchable ? 'success' : 'warning'}>{paper.searchable ? 'AI ready' : 'Reading only'}</Badge><span>{paper.pageCount} pages</span></span>
            <span className="paper-card-title">{paper.title}</span>
            <span className="paper-authors">{paper.authors || 'Authors not added'}{paper.year && <span> · {paper.year}</span>}</span>
            <span className="paper-card-footer"><span title={names.join(', ')}><Folder size={14} /><span className="paper-project-name">{names[0] ?? 'General library'}{names.length > 1 ? ` +${names.length - 1}` : ''}</span></span><span><FileQuestion size={14} />{paper.reviewCount === 0 ? 'Not reviewed' : `${paper.reviewCount} ${paper.reviewCount === 1 ? 'review' : 'reviews'}`}</span><ArrowRight className="paper-open-arrow" size={16} /></span>
          </button>;
        })}
      </div>
      {papers.length === 0 && <EmptyState icon={<Search size={28} />} title={projectName && !view.query && view.status === 'all' ? 'Give this project its first paper' : 'No papers found'} action={projectName && !view.query && view.status === 'all' ? <Button onClick={importPaper} disabled={busy}>{busy ? <Spinner label="Importing PDF" /> : 'Import PDF into project'}</Button> : <Button variant="secondary" onClick={resetFilters}>Clear filters</Button>}>{projectName && !view.query && view.status === 'all' ? 'Import a PDF here, or assign an existing paper from its details.' : 'Try a different title or author, or clear your filters to see the full library.'}</EmptyState>}
    </section>}
  </div>;
}
