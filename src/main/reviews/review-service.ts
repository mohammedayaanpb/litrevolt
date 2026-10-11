import type { PassNumber, Review } from '../../shared/types';
import { PASS_GUIDES } from '../../shared/workflow';
import type { AiEvaluationService } from '../ai/ai-evaluation-service';
import type { LitRevoltDatabase } from '../database/database';

export class ReviewService {
  constructor(
    private readonly database: LitRevoltDatabase,
    private readonly ai: AiEvaluationService,
  ) {}

  start(paperId: string, projectId?: string): Review {
    const paper = this.database.getPaper(paperId);
    if (paper.activeQuizReviewId) throw new Error('Finish the active closed-book quiz before starting another review of this paper.');
    if (!paper.searchable) {
      throw new Error('AI review is unavailable for this PDF because it is not searchable. Use Read & annotate instead.');
    }
    const id = this.database.startReview(paperId, projectId);
    return this.database.getReview(id);
  }

  get(id: string): Review { return this.database.getReview(id); }

  savePassNotes(id: string, pass: PassNumber, notes: Record<string, string>): Review {
    this.ensurePassAccessible(id, pass);
    const allowed = new Set(PASS_GUIDES[pass].prompts.map((prompt) => prompt.key));
    const cleaned = Object.fromEntries(Object.entries(notes)
      .filter(([key, value]) => allowed.has(key) && typeof value === 'string')
      .map(([key, value]) => [key, value.slice(0, 20_000)]));
    this.database.savePassNotes(id, pass, cleaned);
    return this.get(id);
  }

  async generateQuiz(id: string, pass: PassNumber): Promise<Review> {
    const review = this.ensurePassAccessible(id, pass);
    if (!review.paper.searchable) throw new Error('AI review is unavailable for this PDF because it is not searchable.');
    const source = this.database.getPaperSource(review.paperId);
    const { value: questions, provenance } = await this.ai.generateQuiz(source, pass);
    this.database.saveQuiz(id, pass, questions, provenance);
    return this.get(id);
  }

  async submitQuiz(id: string, pass: PassNumber, answers: Record<string, string>): Promise<Review> {
    const review = this.ensurePassAccessible(id, pass);
    const attempt = review.passes.find((item) => item.pass === pass)?.attempt;
    if (!attempt) throw new Error('Generate this pass quiz first.');
    if (attempt.grading) throw new Error('This quiz attempt has already been submitted.');
    const cleanedAnswers: Record<string, string> = {};
    for (const question of attempt.questions) {
      const answer = answers[question.id]?.trim();
      if (!answer) throw new Error('Answer every question before submitting the closed-book quiz.');
      if (question.type === 'multiple-choice' && (!question.options || !question.options.includes(answer))) {
        throw new Error('Choose one of the provided answers for every multiple-choice question.');
      }
      cleanedAnswers[question.id] = answer.slice(0, 20_000);
    }
    this.database.saveQuizAnswers(attempt.id, cleanedAnswers);
    const source = this.database.getPaperSource(review.paperId);
    const { value: grading, provenance } = await this.ai.gradeQuiz(source, attempt.questions, cleanedAnswers);
    this.database.gradeQuiz(attempt.id, cleanedAnswers, grading, grading.totalScore, provenance);
    return this.get(id);
  }

  completePass(id: string, pass: PassNumber): Review {
    this.ensurePassAccessible(id, pass);
    this.database.completePass(id, pass);
    return this.get(id);
  }

  saveWriting(id: string, kind: 'summary' | 'critical-review', text: string): Review {
    const review = this.get(id);
    if (review.passes.some((pass) => pass.status !== 'complete')) throw new Error('Complete all three passes before writing the final review.');
    this.database.saveWriting(id, kind, text.slice(0, 100_000));
    return this.get(id);
  }

  async evaluateWriting(id: string, kind: 'summary' | 'critical-review'): Promise<Review> {
    const review = this.get(id);
    if (review.passes.some((pass) => pass.status !== 'complete')) throw new Error('Complete all three passes before requesting a writing evaluation.');
    const submission = kind === 'summary' ? review.summary : review.criticalReview;
    const minimum = kind === 'summary' ? 100 : 200;
    if (submission.trim().length < minimum) throw new Error(`Write at least ${minimum} characters before requesting evaluation.`);
    const source = this.database.getPaperSource(review.paperId);
    const { value: evaluation, provenance } = await this.ai.evaluateWriting(source, kind, submission);
    this.database.saveWritingEvaluation(id, kind, submission, evaluation, evaluation.score, provenance);
    return this.get(id);
  }

  private ensurePassAccessible(id: string, pass: PassNumber): Review {
    const review = this.get(id);
    const progress = review.passes.find((item) => item.pass === pass);
    if (!progress || progress.status === 'locked') throw new Error(`Pass ${pass} is locked. Complete the previous pass first.`);
    if (progress.status === 'complete') throw new Error(`Pass ${pass} is already complete.`);
    return review;
  }
}
