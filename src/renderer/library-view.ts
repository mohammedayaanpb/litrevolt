import type { Paper } from '../shared/types';

export interface LibraryViewState {
  query: string;
  projectId: string;
  status: 'all' | 'unread' | 'reviewed';
  sort: 'newest' | 'oldest' | 'title' | 'year';
  layout: 'grid' | 'list';
}

export const DEFAULT_LIBRARY_VIEW: LibraryViewState = {
  query: '', projectId: 'all', status: 'all', sort: 'newest', layout: 'grid',
};

export function selectPapers(papers: Paper[], view: LibraryViewState): Paper[] {
  const terms = view.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return papers.filter((paper) => {
    const projectMatches = view.projectId === 'all' || (view.projectId === 'unfiled'
      ? paper.projectIds.length === 0 : paper.projectIds.includes(view.projectId));
    const statusMatches = view.status === 'all' || (view.status === 'unread' ? paper.reviewCount === 0 : paper.reviewCount > 0);
    const searchable = `${paper.title} ${paper.authors} ${paper.year}`.toLocaleLowerCase();
    return projectMatches && statusMatches && terms.every((term) => searchable.includes(term));
  }).sort((a, b) => {
    if (view.sort === 'title') return a.title.localeCompare(b.title);
    if (view.sort === 'year') return (Number.parseInt(b.year, 10) || 0) - (Number.parseInt(a.year, 10) || 0) || a.title.localeCompare(b.title);
    const dateOrder = a.createdAt.localeCompare(b.createdAt);
    return (view.sort === 'oldest' ? dateOrder : -dateOrder) || a.title.localeCompare(b.title);
  });
}
