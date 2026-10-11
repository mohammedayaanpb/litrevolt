import { useEffect, useState } from 'react';
import type { AppSettings, LibrarySnapshot, Paper, Review } from '../shared/types';
import { AboutScreen } from './components/AboutScreen';
import { Layout, type MainView } from './components/Layout';
import { LibraryScreen } from './components/LibraryScreen';
import { PaperDetail } from './components/PaperDetail';
import { ProjectsScreen } from './components/ProjectsScreen';
import { ReviewWorkspace } from './components/ReviewWorkspace';
import { ReviewsScreen } from './components/ReviewsScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { SetupWizard } from './components/SetupWizard';
import { Spinner, Toast } from './components/ui';
import { DEFAULT_LIBRARY_VIEW, type LibraryViewState } from './library-view';
import { DEFAULT_REVIEWS_VIEW, type ReviewsViewState } from './reviews-view';

type Route =
  | { type: 'main'; view: MainView }
  | { type: 'paper'; paperId: string }
  | { type: 'review'; reviewId: string; origin: 'paper' | 'reviews' };

interface ToastState { message: string; tone: 'success' | 'error' }

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot | null>(null);
  const [route, setRoute] = useState<Route>({ type: 'main', view: 'library' });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState('');
  const [libraryView, setLibraryView] = useState<LibraryViewState>(DEFAULT_LIBRARY_VIEW);
  const [reviewsView, setReviewsView] = useState<ReviewsViewState>(DEFAULT_REVIEWS_VIEW);

  const notify = (message: string, tone: 'success' | 'error' = 'success') => setToast({ message, tone });

  const refreshLibrary = async () => {
    const next = await window.litrevolt.library.get();
    setLibrary(next);
    return next;
  };

  const loadApplication = async () => {
    setLoading(true);
    setFatalError('');
    try {
      const value = await window.litrevolt.app.getSettings();
      setSettings(value);
      document.documentElement.dataset.theme = value.theme;
      if (value.setupComplete) await refreshLibrary();
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadApplication(); }, []);

  useEffect(() => {
    const title = route.type === 'paper' && library
      ? `LitRevolt — ${library.papers.find((paper) => paper.id === route.paperId)?.title ?? 'Paper'}`
      : route.type === 'review' ? 'LitRevolt — Review' : route.type === 'main' ? `LitRevolt — ${route.view[0].toUpperCase()}${route.view.slice(1)}` : 'LitRevolt';
    document.title = title;
  }, [route, library]);

  if (loading) return <div className="splash"><Spinner label="Opening LitRevolt" /></div>;

  if (fatalError || !settings) return <div className="fatal-screen" role="alert">
    <div><span className="eyebrow">Local library unavailable</span><h1>LitRevolt could not open</h1>
      <p>{fatalError || 'LitRevolt could not load its local settings.'}</p>
      <button className="button button-primary" onClick={() => void loadApplication()}>Try again</button>
    </div>
  </div>;

  if (!settings.setupComplete) {
    return <SetupWizard onComplete={async (value) => {
      await refreshLibrary();
      setSettings(value);
      document.documentElement.dataset.theme = value.theme;
      notify('Welcome to LitRevolt. Your local library is ready.');
    }} />;
  }

  const navigateMain = (view: MainView) => setRoute({ type: 'main', view });
  const activeMain: MainView = route.type === 'main' ? route.view : route.type === 'review' ? 'reviews' : 'library';
  const papers = library?.papers ?? [];

  let content;
  if (route.type === 'paper') {
    const paper = papers.find((item) => item.id === route.paperId);
    content = paper ? <PaperDetail
      key={paper.id}
      paper={paper}
      projects={library?.projects ?? []}
      recentReviews={(library?.recentReviews ?? []).filter((review) => review.paperId === paper.id)}
      onBack={() => navigateMain('library')}
      onChanged={refreshLibrary}
      onOpenReview={(reviewId) => setRoute({ type: 'review', reviewId, origin: 'paper' })}
      onDeleted={async () => { await refreshLibrary(); navigateMain('library'); }}
      notify={notify}
    /> : <div className="splash">Paper not found.</div>;
  } else if (route.type === 'review') {
    content = <ReviewWorkspace
      key={route.reviewId}
      reviewId={route.reviewId}
      settings={settings}
      backToReviews={route.origin === 'reviews'}
      activeQuizForPaper={(paperId) => library?.papers.find(paper => paper.id === paperId)?.activeQuizReviewId}
      onOpenReview={(reviewId) => setRoute({ ...route, reviewId })}
      onReviewChanged={(review) => setLibrary(current => current ? {
        ...current,
        papers: current.papers.map(paper => paper.id === review.paperId ? review.paper : paper),
        recentReviews: [...current.recentReviews.filter(item => item.id !== review.id), {
          id: review.id, paperId: review.paperId, paperTitle: review.paper.title,
          projectId: review.projectId, projectName: current.projects.find(project => project.id === review.projectId)?.name ?? null,
          name: review.name, status: review.status, currentPass: review.currentPass,
          score: review.score.total, createdAt: review.createdAt, updatedAt: review.updatedAt,
        }].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8),
      } : current)}
      onBack={async (paperId) => {
        try {
          await refreshLibrary();
          if (route.origin === 'reviews') navigateMain('reviews');
          else setRoute({ type: 'paper', paperId });
        } catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); }
      }}
      onExit={() => navigateMain(route.origin === 'reviews' ? 'reviews' : 'library')}
      notify={notify}
    />;
  } else if (route.view === 'library') {
    content = <LibraryScreen
      library={library}
      view={libraryView}
      onViewChange={setLibraryView}
      onOpenPaper={(paper: Paper) => setRoute({ type: 'paper', paperId: paper.id })}
      onOpenReview={(review: Pick<Review, 'id'>) => setRoute({ type: 'review', reviewId: review.id, origin: 'paper' })}
      onRefresh={refreshLibrary}
      notify={notify}
    />;
  } else if (route.view === 'reviews') {
    content = <ReviewsScreen library={library} view={reviewsView} onViewChange={setReviewsView}
      onOpenReview={(reviewId) => setRoute({ type: 'review', reviewId, origin: 'reviews' })}
      onLibrary={() => navigateMain('library')} onRefresh={refreshLibrary} notify={notify} />;
  } else if (route.view === 'projects') {
    content = <ProjectsScreen library={library} onRefresh={refreshLibrary} notify={notify} onOpenPaper={(id) => setRoute({ type: 'paper', paperId: id })} onBrowseProject={(projectId) => {
      setLibraryView({ ...DEFAULT_LIBRARY_VIEW, projectId, layout: libraryView.layout });
      navigateMain('library');
    }} />;
  } else if (route.view === 'settings') {
    content = <SettingsScreen settings={settings} onSettings={(value) => { setSettings(value); document.documentElement.dataset.theme = value.theme; }} notify={notify} />;
  } else {
    content = <AboutScreen />;
  }

  return (
    <>
      <Layout active={activeMain} onNavigate={navigateMain}>{content}</Layout>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}
