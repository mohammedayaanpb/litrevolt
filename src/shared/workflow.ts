import type { PassNumber, ScoreBreakdown } from './types';

export const PASS_GUIDES: Record<PassNumber, {
  title: string;
  goal: string;
  duration: string;
  readingScope: string;
  readingPurpose: string;
  prompts: Array<{ key: string; label: string; hint: string }>;
}> = {
  1: {
    title: 'Survey the landscape',
    goal: 'Build a reliable first impression: category, context, correctness, contribution, and clarity.',
    duration: '5-10 min',
    readingScope: 'Read the title, abstract, introduction and conclusions. Scan section headings and references.',
    readingPurpose: 'Identify category, context, apparent correctness, contributions and clarity; decide whether deeper reading is worthwhile.',
    prompts: [
      { key: 'category', label: 'Category', hint: 'What kind of paper is this?' },
      { key: 'context', label: 'Context', hint: 'Which papers and ideas does it build on?' },
      { key: 'problem', label: 'Problem and contribution', hint: 'What problem is addressed, and what is claimed as new?' },
      { key: 'validity', label: 'Surface validity', hint: 'Do the assumptions and evidence appear coherent?' },
      { key: 'clarity', label: 'Clarity', hint: 'Is the paper well written and organized?' },
    ],
  },
  2: {
    title: 'Trace the argument',
    goal: 'Read with care, inspect evidence, and reconstruct how each result supports the central claims.',
    duration: 'Up to 60 min',
    readingScope: 'Read the paper carefully, especially figures and graphs. Defer detailed proofs and mark relevant unread references.',
    readingPurpose: 'Explain the main argument and supporting evidence in your own words.',
    prompts: [
      { key: 'approach', label: 'Approach', hint: 'Describe the method in your own words.' },
      { key: 'evidence', label: 'Key evidence', hint: 'Which experiments, proofs, or analyses carry the argument?' },
      { key: 'figures', label: 'Figures and tables', hint: 'What do the most important visuals demonstrate?' },
      { key: 'assumptions', label: 'Assumptions', hint: 'Which assumptions matter to the conclusions?' },
      { key: 'questions', label: 'Unresolved questions', hint: 'What remains unclear after a careful second pass?' },
    ],
  },
  3: {
    title: 'Reconstruct and challenge',
    goal: 'Re-create the work mentally, identify hidden assumptions, and test the limits of the contribution.',
    duration: 'Several hours',
    readingScope: 'Revisit the entire paper in detail, including proofs and assumptions. Mentally reconstruct the work and compare it with the authors’ approach.',
    readingPurpose: 'Identify hidden assumptions, strengths, weaknesses and possible future work.',
    prompts: [
      { key: 'reconstruction', label: 'Independent reconstruction', hint: 'How would you reproduce the work without looking at the paper?' },
      { key: 'comparison', label: 'Compare approaches', hint: 'Where would your approach differ, and why?' },
      { key: 'limitations', label: 'Limitations', hint: 'What fails, remains untested, or is overclaimed?' },
      { key: 'replication', label: 'Replication plan', hint: 'What would you need to reproduce the central result?' },
      { key: 'future', label: 'New directions', hint: 'What research questions follow from this work?' },
    ],
  },
};

export const SCORE_WEIGHTS = {
  pass1: 15,
  pass2: 20,
  pass3: 25,
  summary: 20,
  criticalReview: 20,
} as const;

export function calculateUnderstandingScore(input: {
  pass1?: number | null;
  pass2?: number | null;
  pass3?: number | null;
  summary?: number | null;
  criticalReview?: number | null;
}): ScoreBreakdown {
  const weighted = (score: number | null | undefined, weight: number) => {
    if (score == null || !Number.isFinite(score)) return 0;
    const clamped = Math.max(0, Math.min(100, score));
    return Math.round((clamped / 100) * weight * 10) / 10;
  };

  const result = {
    pass1: weighted(input.pass1, SCORE_WEIGHTS.pass1),
    pass2: weighted(input.pass2, SCORE_WEIGHTS.pass2),
    pass3: weighted(input.pass3, SCORE_WEIGHTS.pass3),
    summary: weighted(input.summary, SCORE_WEIGHTS.summary),
    criticalReview: weighted(input.criticalReview, SCORE_WEIGHTS.criticalReview),
  };

  return {
    ...result,
    total: Math.round(Object.values(result).reduce((sum, value) => sum + value, 0) * 10) / 10,
    complete: [input.pass1, input.pass2, input.pass3, input.summary, input.criticalReview]
      .every((value) => value != null),
  };
}
