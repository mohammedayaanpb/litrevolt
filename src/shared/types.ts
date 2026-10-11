export type PassNumber = 1 | 2 | 3;
export type PassStatus = 'locked' | 'available' | 'in-progress' | 'complete';
export type ReviewStatus = 'in-progress' | 'writing' | 'complete';
export type AnnotationKind = 'note' | 'highlight';

export type AiProviderId = 'anthropic' | 'openai' | 'kimi' | 'gemini';

export interface AiProviderConfig {
  model: string;
  anthropicWorkspaceId?: string;
}

export interface AiProvenance {
  provider: AiProviderId;
  model: string;
  documentMode: 'pdf' | 'page-images';
}

export interface SaveSettingsInput {
  activeProvider?: AiProviderId;
  providers?: Partial<Record<AiProviderId, AiProviderConfig>>;
  theme?: 'light' | 'dark' | 'system';
  automaticBackups?: boolean;
}

export interface SaveApiKeyInput {
  provider: AiProviderId;
  apiKey: string;
}

export interface TestConnectionInput extends AiProviderConfig {
  provider: AiProviderId;
  apiKey?: string;
}

export interface AppSettings {
  setupComplete: boolean;
  privacyAccepted: boolean;
  dataDirectory: string;
  activeProvider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfig & { apiKeyConfigured: boolean }>;
  theme: 'light' | 'dark' | 'system';
  automaticBackups: boolean;
}

export interface SetupInput {
  dataDirectory: string;
  privacyAccepted: boolean;
  apiKey?: string;
  provider?: AiProviderId;
  model?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  paperCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paper {
  id: string;
  title: string;
  authors: string;
  year: string;
  abstract: string;
  originalName: string;
  pageCount: number;
  searchable: boolean;
  projectIds: string[];
  reviewCount: number;
  activeQuizReviewId: string | null;
  createdAt: string;
}

export type PaperUpdateInput = Partial<Pick<Paper, 'title' | 'authors' | 'year' | 'abstract' | 'projectIds'>>;

export interface EvidenceCitation {
  page: number;
  quote: string;
  label?: string;
}

export interface QuizQuestion {
  id: string;
  type: 'short-answer' | 'multiple-choice';
  prompt: string;
  options?: string[];
  focus: string;
}

export interface QuestionGrade {
  questionId: string;
  score: number;
  maxScore: number;
  verdict: 'correct' | 'partial' | 'incorrect';
  feedback: string;
  evidence: EvidenceCitation[];
}

export interface QuizGrading {
  totalScore: number;
  overview: string;
  strengths: string[];
  gaps: string[];
  questionGrades: QuestionGrade[];
}

export interface QuizAttempt {
  id: string;
  pass: PassNumber;
  questions: QuizQuestion[];
  answers: Record<string, string>;
  grading: QuizGrading | null;
  score: number | null;
  createdAt: string;
  completedAt: string | null;
  generationProvenance?: AiProvenance | null;
  gradingProvenance?: AiProvenance | null;
}

export interface PassProgress {
  pass: PassNumber;
  status: PassStatus;
  notes: Record<string, string>;
  startedAt: string | null;
  completedAt: string | null;
  attempt: QuizAttempt | null;
}

export interface WritingEvaluation {
  id: string;
  kind: 'summary' | 'critical-review';
  score: number;
  overview: string;
  rubric: Array<{
    criterion: string;
    score: number;
    maxScore: number;
    feedback: string;
  }>;
  strengths: string[];
  improvements: string[];
  evidence: EvidenceCitation[];
  createdAt: string;
  provenance?: AiProvenance | null;
}

export interface ScoreBreakdown {
  pass1: number;
  pass2: number;
  pass3: number;
  summary: number;
  criticalReview: number;
  total: number;
  complete: boolean;
}

export interface Review {
  id: string;
  name: string;
  paperId: string;
  projectId: string | null;
  status: ReviewStatus;
  currentPass: PassNumber;
  summary: string;
  criticalReview: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  paper: Paper;
  passes: PassProgress[];
  summaryEvaluation: WritingEvaluation | null;
  criticalEvaluation: WritingEvaluation | null;
  score: ScoreBreakdown;
}

export interface ReviewSummary {
  id: string;
  name: string;
  paperId: string;
  paperTitle: string;
  projectId: string | null;
  projectName: string | null;
  status: ReviewStatus;
  currentPass: PassNumber;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: string;
  paperId: string;
  reviewId: string | null;
  page: number;
  kind: AnnotationKind;
  content: string;
  quote: string;
  color: string;
  rects: HighlightRect[];
  createdAt: string;
  updatedAt: string;
}

export type AnnotationInput = Omit<Annotation, 'id' | 'rects' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  rects?: HighlightRect[];
};

export interface LibrarySnapshot {
  papers: Paper[];
  projects: Project[];
  recentReviews: ReviewSummary[];
}

export interface ImportResult {
  paper: Paper;
  duplicate: boolean;
}

export interface ApiResult {
  ok: boolean;
  message: string;
}

export interface AboutInfo {
  version: string;
  githubUrl: string | null;
}

export interface LitRevoltAPI {
  app: {
    getSettings(): Promise<AppSettings>;
    chooseDataDirectory(): Promise<string | null>;
    completeSetup(input: SetupInput): Promise<AppSettings>;
    saveSettings(input: SaveSettingsInput): Promise<AppSettings>;
    saveApiKey(input: SaveApiKeyInput): Promise<ApiResult>;
    testApiKey(input: TestConnectionInput): Promise<ApiResult>;
    createBackup(): Promise<string>;
    getAbout(): Promise<AboutInfo>;
    openExternal(url: string): Promise<void>;
  };
  library: {
    get(): Promise<LibrarySnapshot>;
    importPaper(projectId?: string): Promise<ImportResult | null>;
    updatePaper(id: string, input: PaperUpdateInput): Promise<Paper>;
    deletePaper(id: string): Promise<void>;
    getPdfData(id: string): Promise<Uint8Array>;
    createProject(input: { name: string; description: string }): Promise<Project>;
    updateProject(id: string, input: { name: string; description: string }): Promise<Project>;
    deleteProject(id: string): Promise<void>;
    setPaperProjects(paperId: string, projectIds: string[]): Promise<void>;
  };
  reviews: {
    start(paperId: string, projectId?: string): Promise<Review>;
    get(id: string): Promise<Review>;
    list(): Promise<ReviewSummary[]>;
    listForPaper(paperId: string): Promise<ReviewSummary[]>;
    rename(id: string, name: string): Promise<ReviewSummary>;
    delete(id: string): Promise<void>;
    savePassNotes(id: string, pass: PassNumber, notes: Record<string, string>): Promise<Review>;
    generateQuiz(id: string, pass: PassNumber): Promise<Review>;
    submitQuiz(id: string, pass: PassNumber, answers: Record<string, string>): Promise<Review>;
    completePass(id: string, pass: PassNumber): Promise<Review>;
    saveWriting(id: string, kind: 'summary' | 'critical-review', text: string): Promise<Review>;
    evaluateWriting(id: string, kind: 'summary' | 'critical-review'): Promise<Review>;
    listAnnotations(paperId: string, reviewId?: string): Promise<Annotation[]>;
    saveAnnotation(input: AnnotationInput): Promise<Annotation>;
    deleteAnnotation(id: string): Promise<void>;
  };
}

declare global {
  interface Window {
    litrevolt: LitRevoltAPI;
  }
}
