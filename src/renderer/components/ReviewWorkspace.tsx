import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Award, BookOpen, Brain, Check, CheckCircle2, EyeOff, FilePenLine, LockKeyhole, RefreshCw, Save, Send, Sparkles, Target } from 'lucide-react';
import type { AppSettings, EvidenceCitation, PassNumber, PassProgress, QuizQuestion, Review, WritingEvaluation } from '../../shared/types';
import { PROVIDER_LABELS } from '../../shared/config';
import { PASS_GUIDES, SCORE_WEIGHTS } from '../../shared/workflow';
import { clearMatchingDraft, draftKey, draftsEqual, readLocalDraft, writeLocalDraft, type DraftValue } from '../local-drafts';
import { PdfViewer } from './PdfViewer';
import { Badge, Button, Card, Field, Spinner } from './ui';

type Section = PassNumber | 'writing' | 'score';
type WritingKind = 'summary' | 'critical-review';

function useLocalDraft<T extends DraftValue>(key: string, saved: T) {
  const [value, setValue] = useState(() => readLocalDraft(key, saved));
  const [storageFailed, setStorageFailed] = useState(false);
  const update = (next: T) => {
    // Persist in the input handler so navigation or closing the app cannot race a debounce.
    setStorageFailed(!writeLocalDraft(key, next));
    setValue(next);
  };
  const status = draftsEqual(value, saved) ? 'saved' : storageFailed ? 'error' : 'local';
  return { value, update, status, clearSaved: (snapshot: T) => clearMatchingDraft(key, snapshot) };
}

function DraftStatus({ status, savedLabel, localLabel, errorLabel = 'Could not keep a local copy. Keep this page open and save your work before leaving.' }: { status: string; savedLabel: string; localLabel: string; errorLabel?: string }) {
  return <p className={`draft-status ${status === 'error' ? 'draft-status-error' : ''}`} role="status">{status === 'error' ? errorLabel : status === 'local' ? localLabel : savedLabel}</p>;
}

export function ReviewWorkspace({ reviewId, settings, backToReviews = false, activeQuizForPaper, onBack, onExit, onOpenReview, onReviewChanged, notify }: {
  reviewId: string;
  settings: AppSettings;
  backToReviews?: boolean;
  activeQuizForPaper(paperId: string): string | null | undefined;
  onBack(paperId: string): void;
  onExit(): void;
  onOpenReview(id: string): void;
  onReviewChanged(review: Review): void;
  notify(message: string, tone?: 'success' | 'error'): void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [section, setSection] = useState<Section>(1);
  const [writingKind, setWritingKind] = useState<WritingKind>('summary');
  const [pdfPage, setPdfPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState('');
  const sourceRef = useRef<HTMLDivElement>(null);
  const aiLabel = PROVIDER_LABELS[settings.activeProvider] + ' · ' + settings.providers[settings.activeProvider].model;

  useEffect(() => {
    let active = true;
    setReview(null);
    setLoadError('');
    window.litrevolt.reviews.get(reviewId).then((value) => {
      if (!active) return;
      setReview(value);
      onReviewChanged(value);
      setSection(value.status === 'complete' ? 'score' : value.status === 'writing' ? 'writing' : value.currentPass);
    }).catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : String(error);
      setLoadError(message);
      notify(message, 'error');
    });
    return () => { active = false; };
  }, [reviewId]);

  const act = async (label: string, action: () => Promise<Review>, success?: string) => {
    setBusy(label);
    try { const value = await action(); setReview(value); onReviewChanged(value); if (success) notify(success); return value; }
    catch (error) { notify(error instanceof Error ? error.message : String(error), 'error'); return null; }
    finally { setBusy(''); }
  };

  if (loadError) return <div className="fatal-screen" role="alert"><div><span className="eyebrow">Review unavailable</span><h1>LitRevolt could not open this review</h1><p>{loadError}</p><Button onClick={onExit}>Return to {backToReviews ? 'reviews' : 'library'}</Button></div></div>;
  if (!review) return <div className="splash"><Spinner label="Opening review" /></div>;
  const currentQuiz = activeQuizForPaper(review.paperId);
  const activeQuizReviewId = currentQuiz === undefined ? review.paper.activeQuizReviewId : currentQuiz;
  if (activeQuizReviewId && activeQuizReviewId !== review.id) return <div className="page paper-detail-page">
    <button className="back-link" onClick={() => onBack(review.paperId)}><ArrowLeft size={17} /> {backToReviews ? 'Back to reviews' : 'Back to paper'}</button>
    <Card className="closed-book-paper-card"><EyeOff size={42} /><span className="eyebrow">Closed-book checkpoint</span><h1>This review is paused</h1>
      <p>Another review of this paper has an active quiz. Finish it before opening notes, feedback, or the source in this review.</p>
      <Button onClick={() => onOpenReview(activeQuizReviewId)}>Resume active quiz</Button>
    </Card>
  </div>;
  const activePass = typeof section === 'number' ? review.passes.find((item) => item.pass === section)! : null;
  const openAttempt = review.passes.find((pass) => pass.attempt && !pass.attempt.grading);
  const closedBook = Boolean(openAttempt);
  const jumpToEvidence = (citation: EvidenceCitation) => {
    setPdfPage(Math.max(1, Math.min(review.paper.pageCount, citation.page)));
    if (window.matchMedia('(max-width: 1050px)').matches) sourceRef.current?.scrollIntoView({ block: 'start' });
  };

  return <div className="review-page">
    <header className="review-header">
      <button className="back-link" disabled={closedBook && !backToReviews} title={closedBook && !backToReviews ? 'Submit the closed-book quiz before returning to the paper.' : undefined} onClick={() => onBack(review.paperId)}><ArrowLeft size={17} /> {backToReviews ? 'Reviews' : 'Paper'}</button>
      <div className="review-paper-title"><span className="eyebrow">{review.status === 'complete' ? 'Completed review' : 'Active review'}</span><h1 title={review.name}>{review.name}</h1><span className="review-source-title" title={review.paper.title}>{review.paper.title}</span></div>
      <div className="review-header-score"><span>{review.score.complete ? 'Understanding' : 'In progress'}</span><strong>{review.score.total}<small>/100</small></strong></div>
    </header>
    <nav className="pass-nav" aria-label="Review stages">
      {review.passes.map((pass) => <button key={pass.pass} className={section === pass.pass ? 'active' : ''} aria-current={section === pass.pass ? 'step' : undefined} disabled={pass.status === 'locked' || Boolean(openAttempt && openAttempt.pass !== pass.pass)} onClick={() => setSection(pass.pass)}>
        <span className="pass-number">{pass.status === 'complete' ? <Check size={15} /> : pass.status === 'locked' ? <LockKeyhole size={14} /> : pass.pass}</span>
        <span><strong>Pass {pass.pass}</strong><small>{PASS_GUIDES[pass.pass].title}</small></span>
      </button>)}
      <button className={section === 'writing' ? 'active' : ''} aria-current={section === 'writing' ? 'step' : undefined} disabled={Boolean(openAttempt) || review.passes.some((pass) => pass.status !== 'complete')} onClick={() => setSection('writing')}><span className="pass-number"><FilePenLine size={15} /></span><span><strong>Write</strong><small>Synthesize & critique</small></span></button>
      <button className={section === 'score' ? 'active' : ''} aria-current={section === 'score' ? 'step' : undefined} disabled={Boolean(openAttempt)} onClick={() => setSection('score')}><span className="pass-number"><Award size={15} /></span><span><strong>Score</strong><small>Evidence of understanding</small></span></button>
    </nav>
    <div className={`review-workspace ${closedBook ? 'closed-book-active' : ''}`}>
      <div className="review-source" id="review-source" ref={sourceRef}>
        {closedBook ? <div className="closed-book-shield"><EyeOff size={42} /><span className="eyebrow">Closed-book mode</span><h2>The paper is hidden</h2><p>Retrieval is part of the method. Answer from memory; the source returns after you submit.</p><div className="closed-book-rule" /></div>
          : <PdfViewer paperId={review.paperId} reviewId={review.id} page={pdfPage} onPage={setPdfPage} notify={notify} />}
      </div>
      <section className="review-panel" key={activePass
        ? `${review.id}:${section}:${activePass.attempt?.id ?? 'reading'}:${activePass.attempt?.grading ? 'results' : 'questions'}`
        : `${review.id}:${section}`}>
        {activePass && <PassPanel aiLabel={aiLabel} review={review} progress={activePass} closedBook={closedBook} busy={busy} act={act} setSection={setSection} onEvidence={jumpToEvidence} />}
        {section === 'writing' && <WritingPanel aiLabel={aiLabel} review={review} initialKind={writingKind} busy={busy} act={act} onEvidence={jumpToEvidence} />}
        {section === 'score' && <ScorePanel review={review} onSection={setSection} onWriting={(kind) => { setWritingKind(kind); setSection('writing'); }} />}
      </section>
    </div>
  </div>;
}

function PassPanel({ aiLabel, review, progress, closedBook, busy, act, setSection, onEvidence }: {
  aiLabel: string; review: Review; progress: PassProgress; closedBook: boolean; busy: string;
  act(label: string, action: () => Promise<Review>, success?: string): Promise<Review | null>;
  setSection(section: Section): void; onEvidence(citation: EvidenceCitation): void;
}) {
  const guide = PASS_GUIDES[progress.pass];
  const notesDraft = useLocalDraft(draftKey(review.id, `pass:${progress.pass}:notes`, review.paperId), progress.notes);
  const answerDraft = useLocalDraft(draftKey(review.id, `pass:${progress.pass}:attempt:${progress.attempt?.id ?? 'none'}`, review.paperId), progress.attempt?.answers ?? {});
  const notes = notesDraft.value;
  const answers = answerDraft.value;
  const saveNotes = async () => {
    const value = await act('notes', () => window.litrevolt.reviews.savePassNotes(review.id, progress.pass, notes), 'Reading notes saved.');
    if (value && draftsEqual(value.passes.find((pass) => pass.pass === progress.pass)!.notes, notes)) notesDraft.clearSaved(notes);
  };
  const generateQuiz = () => act('generate', async () => {
    const saved = await window.litrevolt.reviews.savePassNotes(review.id, progress.pass, notes);
    if (draftsEqual(saved.passes.find((pass) => pass.pass === progress.pass)!.notes, notes)) notesDraft.clearSaved(notes);
    return window.litrevolt.reviews.generateQuiz(review.id, progress.pass);
  });
  const submitQuiz = async () => {
    const value = await act('submit', () => window.litrevolt.reviews.submitQuiz(review.id, progress.pass, answers), 'Quiz graded against the paper.');
    if (value) answerDraft.clearSaved(answers);
  };

  const nextSection: Section = progress.pass < 3 ? (progress.pass + 1) as PassNumber : 'writing';
  return <div className="pass-panel-content">
    <header className="panel-heading"><div><span className="eyebrow">Pass {progress.pass} · {guide.duration}</span><h2>{guide.title}</h2><p>{guide.goal}</p></div><Badge tone={progress.status === 'complete' ? 'success' : 'accent'}>{progress.status.replace('-', ' ')}</Badge></header>
    {!closedBook && <section className="pass-reading-guide" aria-labelledby="pass-reading-guide-heading">
      <BookOpen size={18} aria-hidden="true" />
      <div><h3 id="pass-reading-guide-heading">What to read</h3><p>{guide.readingScope}</p></div>
    </section>}
    {!progress.attempt && <>
      <section className="guided-prompts"><div className="panel-section-title"><Target size={18} /><div><h3>Reading record</h3><p>Capture your own understanding before testing it.</p></div></div>
        {guide.prompts.map((prompt) => <Field key={prompt.key} label={prompt.label} hint={prompt.hint}><textarea rows={3} maxLength={20_000} value={notes[prompt.key] ?? ''} disabled={busy === 'generate'} onChange={(event) => notesDraft.update({ ...notes, [prompt.key]: event.target.value })} /></Field>)}
        <DraftStatus status={notesDraft.status} savedLabel={Object.values(notes).some((note) => note.trim()) ? 'Notes saved to this review.' : 'Notes are kept on this device as you type.'} localLabel="Draft kept on this device. Save notes to add them to the review." />
        <Button variant="secondary" disabled={busy !== ''} onClick={saveNotes}><Save size={16} /> {busy === 'notes' ? <Spinner label="Saving" /> : 'Save notes'}</Button>
      </section>
      <section className="quiz-launch"><div className="quiz-icon"><Brain /></div><div><span className="eyebrow">Retrieval checkpoint</span><h3>Test what stayed with you</h3><p>{aiLabel} will generate a paper-specific quiz. Once it begins, LitRevolt hides the PDF until you submit every answer. Your reading notes are saved when you begin.</p>{!review.paper.searchable && <p>This PDF needs searchable text before a quiz can be generated.</p>}</div><Button disabled={busy !== '' || !review.paper.searchable} onClick={generateQuiz}>{busy === 'generate' ? <Spinner label="Building quiz" /> : <><Sparkles size={16} /> Generate closed-book quiz</>}</Button></section>
    </>}
    {progress.attempt && !progress.attempt.grading && <QuizForm aiLabel={aiLabel} questions={progress.attempt.questions} answers={answers} setAnswers={answerDraft.update} draftStatus={answerDraft.status} busy={busy} onSubmit={submitQuiz} />}
    {progress.attempt?.grading && <>
      <QuizResults progress={progress} onEvidence={onEvidence} />
      {progress.status !== 'complete' && <div className="complete-pass-card"><CheckCircle2 size={25} /><div><h3>Ready to move deeper?</h3><p>Your score records current understanding; completion unlocks the next stage.</p></div><Button disabled={busy !== ''} onClick={async () => { const value = await act('complete', () => window.litrevolt.reviews.completePass(review.id, progress.pass), `Pass ${progress.pass} complete.`); if (value) setSection(nextSection); }}>{busy === 'complete' ? <Spinner label="Completing" /> : <>Complete Pass {progress.pass} <ArrowRight size={16} /></>}</Button></div>}
      {progress.status === 'complete' && <Button className="next-stage" onClick={() => setSection(nextSection)}>Continue to {progress.pass < 3 ? `Pass ${progress.pass + 1}` : 'writing'} <ArrowRight size={16} /></Button>}
    </>}
  </div>;
}

function QuizForm({ aiLabel, questions, answers, setAnswers, draftStatus, busy, onSubmit }: { aiLabel: string; questions: QuizQuestion[]; answers: Record<string, string>; setAnswers(value: Record<string, string>): void; draftStatus: string; busy: string; onSubmit(): void }) {
  const complete = questions.every((question) => answers[question.id]?.trim());
  return <section className="quiz-form"><header><EyeOff size={23} /><div><span className="eyebrow">Closed-book checkpoint</span><h2>Answer from memory</h2><p>All {questions.length} responses are required. Your answers are sent to {aiLabel} for grading only after submission.</p></div></header>
    <DraftStatus status={draftStatus} savedLabel="Answers are kept on this device as you type." localLabel="Answer draft kept on this device. You can resume this closed-book quiz after reopening the app." errorLabel="Could not keep a local copy. Keep this quiz open until you submit your answers." />
    {questions.map((question, index) => <div className="quiz-question" key={question.id}><div className="question-label"><span>{index + 1}</span><small>{question.focus}</small></div><h3 id={`question-${question.id}`}>{question.prompt}</h3>
      {question.type === 'multiple-choice' && question.options ? <div className="quiz-options" role="radiogroup" aria-labelledby={`question-${question.id}`}>{question.options.map((option) => <label key={option}><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} disabled={busy === 'submit'} onChange={() => setAnswers({ ...answers, [question.id]: option })} /><span>{option}</span></label>)}</div>
        : <textarea rows={5} maxLength={20_000} aria-labelledby={`question-${question.id}`} value={answers[question.id] ?? ''} disabled={busy === 'submit'} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} placeholder="Explain in your own words…" />}
    </div>)}
    <div className="quiz-submit"><p>{questions.filter((question) => answers[question.id]?.trim()).length} of {questions.length} answered{!complete ? ' · Answer every question to submit.' : ' · Ready to submit.'}</p><Button disabled={!complete || busy !== ''} onClick={onSubmit}>{busy === 'submit' ? <Spinner label="Grading against paper" /> : <><Send size={16} /> Submit for paper-grounded grading</>}</Button></div>
  </section>;
}

function QuizResults({ progress, onEvidence }: { progress: PassProgress; onEvidence(citation: EvidenceCitation): void }) {
  const grading = progress.attempt!.grading!;
  return <section className="quiz-results"><div className="result-hero"><ScoreRing score={grading.totalScore} /><div><span className="eyebrow">Pass {progress.pass} quiz</span><h2>{grading.totalScore >= 85 ? 'Strong retrieval' : grading.totalScore >= 65 ? 'Developing understanding' : 'Revisit the paper'}</h2><p>{grading.overview}</p></div></div>
    <div className="feedback-columns"><div><h3>What held</h3>{grading.strengths.map((value) => <p key={value}><Check size={15} /> {value}</p>)}</div><div><h3>What to revisit</h3>{grading.gaps.map((value) => <p key={value}><RefreshCw size={15} /> {value}</p>)}</div></div>
    <div className="question-results">{grading.questionGrades.map((grade, index) => {
      const question = progress.attempt!.questions.find((item) => item.id === grade.questionId);
      const questionNumber = progress.attempt!.questions.findIndex((item) => item.id === grade.questionId) + 1;
      return <details key={grade.questionId} open={grade.verdict !== 'correct'}><summary><span className={`verdict verdict-${grade.verdict}`} /> <strong>Question {questionNumber || index + 1}</strong><Badge tone={grade.verdict === 'correct' ? 'success' : grade.verdict === 'partial' ? 'warning' : 'neutral'}>{grade.score}/{grade.maxScore}</Badge></summary><div className="question-context">{question && <div><span className="eyebrow">Question</span><p>{question.prompt}</p></div>}<div><span className="eyebrow">Your answer</span><p>{progress.attempt!.answers[grade.questionId] || 'No answer recorded.'}</p></div></div><p>{grade.feedback}</p><CitationList citations={grade.evidence} onEvidence={onEvidence} /></details>;
    })}</div>
  </section>;
}

function WritingPanel({ aiLabel, review, initialKind, busy, act, onEvidence }: { aiLabel: string; review: Review; initialKind: WritingKind; busy: string; act(label: string, action: () => Promise<Review>, success?: string): Promise<Review | null>; onEvidence(citation: EvidenceCitation): void }) {
  const [kind, setKind] = useState<WritingKind>(initialKind);
  const summaryDraft = useLocalDraft(draftKey(review.id, 'writing:summary', review.paperId), review.summary);
  const criticalDraft = useLocalDraft(draftKey(review.id, 'writing:critical-review', review.paperId), review.criticalReview);
  const draft = kind === 'summary' ? summaryDraft : criticalDraft;
  const text = draft.value;
  const savedText = kind === 'summary' ? review.summary : review.criticalReview;
  const savedEvaluation = kind === 'summary' ? review.summaryEvaluation : review.criticalEvaluation;
  const evaluation = text === savedText ? savedEvaluation : null;
  const minimumCharacters = kind === 'summary' ? 100 : 200;
  const characterCount = text.trim().length;
  const remaining = Math.max(0, minimumCharacters - characterCount);
  const save = async () => {
    const value = await act('save-writing', () => window.litrevolt.reviews.saveWriting(review.id, kind, text), 'Writing saved.');
    if (value && (kind === 'summary' ? value.summary : value.criticalReview) === text) draft.clearSaved(text);
  };
  const evaluate = async () => {
    const value = await act('evaluate', async () => {
      await window.litrevolt.reviews.saveWriting(review.id, kind, text);
      return window.litrevolt.reviews.evaluateWriting(review.id, kind);
    }, 'Writing evaluated against the paper.');
    if (value && (kind === 'summary' ? value.summary : value.criticalReview) === text) draft.clearSaved(text);
  };
  return <div className="writing-panel"><header className="panel-heading"><div><span className="eyebrow">Synthesis</span><h2>Make the understanding yours</h2><p>Write without outsourcing the thinking. Evaluation uses {aiLabel} only after you submit.</p></div></header>
    <div className="writing-tabs"><button className={kind === 'summary' ? 'active' : ''} aria-pressed={kind === 'summary'} disabled={busy !== ''} onClick={() => setKind('summary')}>Paper summary <span>{SCORE_WEIGHTS.summary} pts</span></button><button className={kind === 'critical-review' ? 'active' : ''} aria-pressed={kind === 'critical-review'} disabled={busy !== ''} onClick={() => setKind('critical-review')}>Critical review <span>{SCORE_WEIGHTS.criticalReview} pts</span></button></div>
    <div className="writing-brief"><BookOpen size={19} /><p>{kind === 'summary' ? 'Explain the problem, approach, evidence, and conclusions in your own words. Prioritize what matters.' : 'Interrogate assumptions, methods, evidence, limitations, alternatives, and promising next work.'}</p></div>
    <textarea className="writing-editor" rows={18} maxLength={100_000} aria-label={kind === 'summary' ? 'Paper summary' : 'Critical review'} aria-describedby="writing-requirement" value={text} disabled={busy === 'evaluate'} onChange={(event) => draft.update(event.target.value)} placeholder={kind === 'summary' ? 'Write your paper summary…' : 'Write your critical review…'} />
    <div className="writing-meta"><div className="writing-counts"><span>{text.trim().split(/\s+/).filter(Boolean).length} words · {characterCount} characters</span><span id="writing-requirement">{remaining ? `${remaining} more characters to evaluate (${minimumCharacters} minimum).` : `${minimumCharacters}-character minimum met. Ready to evaluate.`}</span></div><div><Button variant="secondary" onClick={save} disabled={busy !== ''}><Save size={16} /> {busy === 'save-writing' ? <Spinner label="Saving" /> : 'Save draft'}</Button><Button onClick={evaluate} disabled={busy !== '' || remaining > 0}>{busy === 'evaluate' ? <Spinner label="Evaluating" /> : <><Sparkles size={16} /> Evaluate against paper</>}</Button></div></div>
    <DraftStatus status={draft.status} savedLabel={text.trim() ? 'Writing saved to this review.' : 'Writing is kept on this device as you type.'} localLabel="Draft kept on this device. Save draft to add this version to the review." />
    {savedEvaluation && text !== savedText && <p role="status">Draft changed. Existing feedback and score apply to the saved version; evaluate this revision to update them.</p>}
    {evaluation && <WritingResults evaluation={evaluation} onEvidence={onEvidence} />}
  </div>;
}

function WritingResults({ evaluation, onEvidence }: { evaluation: WritingEvaluation; onEvidence(citation: EvidenceCitation): void }) {
  return <section className="writing-results"><div className="result-hero"><ScoreRing score={evaluation.score} /><div><span className="eyebrow">Paper-grounded evaluation</span><h2>{evaluation.score}/100</h2><p>{evaluation.overview}</p></div></div>
    <div className="rubric-list">{evaluation.rubric.map((item) => <div key={item.criterion}><header><strong>{item.criterion}</strong><span>{item.score}/{item.maxScore}</span></header><div className="rubric-track"><span style={{ width: `${Math.min(100, item.score / item.maxScore * 100)}%` }} /></div><p>{item.feedback}</p></div>)}</div>
    <div className="feedback-columns"><div><h3>Strengths</h3>{evaluation.strengths.map((value) => <p key={value}><Check size={15} /> {value}</p>)}</div><div><h3>Improve next</h3>{evaluation.improvements.map((value) => <p key={value}><RefreshCw size={15} /> {value}</p>)}</div></div>
    <CitationList citations={evaluation.evidence} onEvidence={onEvidence} />
  </section>;
}

function ScorePanel({ review, onSection, onWriting }: { review: Review; onSection(section: Section): void; onWriting(kind: WritingKind): void }) {
  const writingLocked = review.passes.some((pass) => pass.status !== 'complete');
  const parts = useMemo(() => [
    { label: 'Pass 1 quiz', value: review.score.pass1, max: SCORE_WEIGHTS.pass1, section: 1 as Section, locked: false },
    { label: 'Pass 2 quiz', value: review.score.pass2, max: SCORE_WEIGHTS.pass2, section: 2 as Section, locked: review.passes[1].status === 'locked' },
    { label: 'Pass 3 quiz', value: review.score.pass3, max: SCORE_WEIGHTS.pass3, section: 3 as Section, locked: review.passes[2].status === 'locked' },
    { label: 'Summary', value: review.score.summary, max: SCORE_WEIGHTS.summary, section: 'writing' as Section, writingKind: 'summary' as const, locked: writingLocked },
    { label: 'Critical review', value: review.score.criticalReview, max: SCORE_WEIGHTS.criticalReview, section: 'writing' as Section, writingKind: 'critical-review' as const, locked: writingLocked },
  ], [review.score, review.passes, writingLocked]);
  return <div className="score-panel"><div className="score-hero"><span className="eyebrow">Evidence-based understanding</span><ScoreRing score={review.score.total} large /><h2>{review.score.complete ? 'Review complete' : 'Understanding in progress'}</h2><p>{review.score.complete ? 'This score combines retrieval across all three passes with paper-grounded evaluation of your synthesis and critique.' : 'Finish each evidence source to make the score complete. Missing work contributes zero until evaluated.'}</p></div>
    <div className="score-breakdown">{parts.map((part) => <button key={part.label} disabled={part.locked} onClick={() => part.writingKind ? onWriting(part.writingKind) : onSection(part.section)}><div><strong>{part.label}</strong><span>{part.value}/{part.max} weighted points{part.locked ? ' · locked' : ''}</span></div><div className="score-track"><span style={{ width: `${part.max ? part.value / part.max * 100 : 0}%` }} /></div>{part.locked ? <LockKeyhole size={15} /> : <ArrowRight size={16} />}</button>)}</div>
    <Card className="score-method"><Target size={21} /><div><h3>How the score works</h3><p>Pass quizzes contribute 15, 20, and 25 points as the reading deepens. The summary and critical review each contribute 20. Every component is graded against the paper and preserved with its feedback.</p></div></Card>
  </div>;
}

function CitationList({ citations, onEvidence }: { citations: EvidenceCitation[]; onEvidence(citation: EvidenceCitation): void }) {
  return <div className="citation-list">{citations.map((citation, index) => <button key={`${citation.page}-${index}`} onClick={() => onEvidence(citation)}><span>p. {citation.page}</span><q>{citation.quote}</q></button>)}</div>;
}

function ScoreRing({ score, large = false }: { score: number; large?: boolean }) {
  return <div className={`score-ring ${large ? 'score-ring-large' : ''}`} style={{ '--score': `${Math.max(0, Math.min(100, score)) * 3.6}deg` } as React.CSSProperties}><div><strong>{Math.round(score)}</strong><span>/100</span></div></div>;
}
