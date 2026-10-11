import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, BookOpenCheck, Calendar, Edit3, FileText, Folder, Play, Save, Trash2, UserRound } from 'lucide-react';
import type { LibrarySnapshot, Paper, Project } from '../../shared/types';
import { clearPaperDrafts } from '../local-drafts';
import { Badge, Button, Card, Field, Spinner } from './ui';
import { PdfViewer } from './PdfViewer';
import { ReviewList } from './ReviewList';

export function PaperDetail({ paper, projects, recentReviews, onBack, onChanged, onOpenReview, onDeleted, notify }: {
  paper: Paper;
  projects: Project[];
  recentReviews: LibrarySnapshot['recentReviews'];
  onBack(): void;
  onChanged(): Promise<LibrarySnapshot>;
  onOpenReview(id: string): void;
  onDeleted(): Promise<void>;
  notify(message: string, tone?: 'success' | 'error'): void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: paper.title, authors: paper.authors, year: paper.year, abstract: paper.abstract });
  const [projectIds, setProjectIds] = useState(paper.projectIds);
  const [savingProjects, setSavingProjects] = useState(false);
  const [projectMessage, setProjectMessage] = useState('');
  const [projectError, setProjectError] = useState('');
  const projectRequestPending = useRef(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [readerPage, setReaderPage] = useState(1);
  const [reviewHistory, setReviewHistory] = useState(() => recentReviews.filter((review) => review.paperId === paper.id));
  const paperReviews = reviewHistory.filter((review) => review.paperId === paper.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const unfinishedReview = paperReviews.find((review) => review.status !== 'complete');
  const reviewsChanged = async () => {
    await Promise.all([
      onChanged(),
      window.litrevolt.reviews.listForPaper(paper.id).then(setReviewHistory),
    ]);
  };

  useEffect(() => {
    if (!projectRequestPending.current) setProjectIds(paper.projectIds);
  }, [paper.projectIds]);

  useEffect(() => {
    let active = true;
    setReviewHistory(recentReviews.filter((review) => review.paperId === paper.id));
    window.litrevolt.reviews.listForPaper(paper.id).then((value) => {
      if (active) setReviewHistory(value);
    }).catch((error: unknown) => {
      if (active) notify(error instanceof Error ? error.message : String(error), 'error');
    });
    return () => { active = false; };
  }, [paper.id]);

  const save = async () => {
    setBusy(true);
    try {
      await window.litrevolt.library.updatePaper(paper.id, form);
      await onChanged(); setEditing(false); notify('Paper details updated.');
    } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setBusy(false); }
  };
  const changeProject = async (project: Project, checked: boolean) => {
    if (busy || projectRequestPending.current) return;
    const previousIds = projectIds;
    const nextIds = checked ? [...new Set([...previousIds, project.id])] : previousIds.filter((id) => id !== project.id);
    projectRequestPending.current = true;
    setSavingProjects(true);
    setProjectError('');
    setProjectMessage('');
    setProjectIds(nextIds);
    try {
      try {
        await window.litrevolt.library.setPaperProjects(paper.id, nextIds);
      } catch (error) {
        setProjectIds(previousIds);
        const message = `Could not update projects. ${error instanceof Error ? error.message : String(error)}`;
        setProjectError(message);
        notify(message, 'error');
        return;
      }
      setProjectMessage(checked ? `Added to ${project.name}.` : `Removed from ${project.name}.`);
      try {
        await onChanged();
      } catch (error) {
        // Assignment already committed. A refresh failure must not undo its UI state.
        const message = `Project selection saved, but the library could not refresh. ${error instanceof Error ? error.message : String(error)}`;
        setProjectError(message);
        notify(message, 'error');
      }
    } finally {
      projectRequestPending.current = false;
      setSavingProjects(false);
    }
  };
  const start = async () => {
    setBusy(true);
    try { const review = await window.litrevolt.reviews.start(paper.id, projectIds.length === 1 ? projectIds[0] : undefined); await onChanged(); onOpenReview(review.id); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Remove “${paper.title}” from LitRevolt? Its managed PDF, reviews, notes, highlights, and scores will be permanently deleted.`)) return;
    try {
      await window.litrevolt.library.deletePaper(paper.id);
      const draftsCleared = clearPaperDrafts(paper.id);
      await onDeleted();
      notify(draftsCleared ? 'Paper and its LitRevolt records were removed.' : 'Paper removed, but local draft recovery copies could not be cleared from this device.', draftsCleared ? 'success' : 'error');
    }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
  };

  if (paper.activeQuizReviewId) return <div className="page paper-detail-page">
    <button ref={backRef} className="back-link" onClick={onBack}><ArrowLeft size={17} /> Back to library</button>
    <Card className="closed-book-paper-card"><BookOpenCheck size={42} /><span className="eyebrow">Closed-book checkpoint</span><h1>The paper is hidden</h1>
      <p>Finish the active quiz before returning to the PDF, abstract, notes, or paper details.</p>
      <Button onClick={() => onOpenReview(paper.activeQuizReviewId!)}>Resume active quiz</Button>
      {paperReviews.length > 0 && <div className="closed-book-review-history"><h2>Reviews</h2><ReviewList reviews={paperReviews} onOpen={onOpenReview} onChanged={reviewsChanged} onEmptyFocus={() => backRef.current?.focus({ preventScroll: true })} notify={notify} compact /></div>}
    </Card>
  </div>;

  if (reading) return <div className="standalone-reader-page">
    <header className="standalone-reader-header"><button className="back-link" onClick={() => setReading(false)}><ArrowLeft size={17} /> Paper details</button><h1>{paper.title}</h1></header>
    <PdfViewer paperId={paper.id} page={readerPage} onPage={setReaderPage} notify={notify} />
  </div>;

  return <div className="page paper-detail-page">
    <button ref={backRef} className="back-link" onClick={onBack}><ArrowLeft size={17} /> Back to library</button>
    <section className="paper-hero">
      <div className="paper-hero-mark"><FileText size={35} /></div>
      <div className="paper-hero-main">
        <div className="paper-status-row"><Badge tone={paper.searchable ? 'success' : 'warning'}>{paper.searchable ? 'Searchable PDF · AI ready' : 'Reading and annotations only'}</Badge><span>{paper.pageCount} pages</span></div>
        {editing ? <Field label="Title"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field> : <h1>{paper.title}</h1>}
        <div className="paper-meta">
          <span><UserRound size={16} /> {paper.authors || 'Authors not detected'}</span>
          {paper.year && <span><Calendar size={16} /> {paper.year}</span>}
          <span><Folder size={16} /> {projectIds.length ? `${projectIds.length} project${projectIds.length > 1 ? 's' : ''}` : 'General library'}</span>
        </div>
      </div>
      <div className="paper-hero-actions">
        {unfinishedReview && <Button onClick={() => onOpenReview(unfinishedReview.id)} disabled={busy || savingProjects}><Play size={17} /> Continue review</Button>}
        {!unfinishedReview && <Button onClick={start} disabled={busy || savingProjects || !paper.searchable} title={paper.searchable ? undefined : 'A searchable PDF is required for closed-book quizzes and review completion.'}>{busy && !editing ? <Spinner label="Starting review" /> : <><Play size={17} /> Start a review</>}</Button>}
        <Button variant="secondary" onClick={() => setReading(true)}><BookOpen size={17} /> Read & annotate</Button>
        {editing ? <Button onClick={save} disabled={busy || savingProjects}>{busy ? <Spinner label="Saving" /> : <><Save size={17} /> Save</>}</Button> : <Button variant="secondary" onClick={() => setEditing(true)}><Edit3 size={17} /> Edit details</Button>}
        {unfinishedReview && <Button variant="ghost" onClick={start} disabled={busy || savingProjects || !paper.searchable}>{busy && !editing ? <Spinner label="Starting review" /> : 'Start another review'}</Button>}
      </div>
    </section>
    {!paper.searchable && <div className="warning-banner"><FileText size={20} /><div><strong>AI review is unavailable for this PDF</strong><p>LitRevolt could not extract searchable text from this document. You can still read and annotate it, but quizzes and written evaluations require a searchable PDF.</p></div></div>}
    <div className="paper-detail-grid">
      <Card className="paper-overview">
        <span className="eyebrow">Paper record</span><h2>Overview</h2>
        {editing ? <>
          <Field label="Authors"><input value={form.authors} onChange={(event) => setForm({ ...form, authors: event.target.value })} /></Field>
          <Field label="Year"><input value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} /></Field>
          <Field label="Abstract"><textarea rows={9} value={form.abstract} onChange={(event) => setForm({ ...form, abstract: event.target.value })} /></Field>
        </> : <p className={paper.abstract ? '' : 'muted'}>{paper.abstract || 'No abstract was detected. Use Edit details to add one.'}</p>}
      </Card>
      <aside className="paper-side-stack">
        <Card><span className="eyebrow">Research contexts</span><h2>Projects</h2>
          {projects.length ? <>
            <p className="muted" id="project-assignment-help">Select projects to add this paper. Changes save automatically.</p>
            <div className="project-checks" role="group" aria-label="Paper projects" aria-describedby="project-assignment-help" aria-busy={savingProjects}>
              {projects.map((project) => <label key={project.id}><input type="checkbox" disabled={busy || savingProjects} checked={projectIds.includes(project.id)} onChange={(event) => void changeProject(project, event.target.checked)} /> <span>{project.name}</span></label>)}
            </div>
            <div className="project-assignment-status" role="status">{savingProjects ? <Spinner label="Saving projects" /> : !projectError && projectMessage}</div>
            {projectError && <p className="form-error" role="alert">{projectError}</p>}
          </> : <p className="muted">Create a project to organize this paper by research context.</p>}
        </Card>
        <Card><span className="eyebrow">Understanding history</span><h2>Reviews</h2>
          {paperReviews.length ? <ReviewList reviews={paperReviews} onOpen={onOpenReview} onChanged={reviewsChanged} onEmptyFocus={() => backRef.current?.focus({ preventScroll: true })} notify={notify} compact /> : <p className="muted">This paper has not been reviewed. Start a LitRevolt review to work through Pass 1, Pass 2, and Pass 3 in sequence.</p>}
        </Card>
        <Button variant="danger" disabled={busy || savingProjects} onClick={remove}><Trash2 size={16} /> Remove paper</Button>
      </aside>
    </div>
  </div>;
}
