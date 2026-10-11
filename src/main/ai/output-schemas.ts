import { z } from 'zod';

// Transport schemas use only a common strict-JSON subset. Semantic checks (exact
// scores, IDs and citations) remain in the evaluator, independent of the API.
const citation = z.object({ page: z.number().int(), quote: z.string(), label: z.string().nullable() });
const schemas = {
  quiz: z.object({ questions: z.array(z.object({
    id: z.string(), type: z.enum(['short-answer', 'multiple-choice']), prompt: z.string(),
    focus: z.string(), options: z.array(z.string()).nullable(),
  })) }),
  grading: z.object({
    totalScore: z.number(), overview: z.string(), strengths: z.array(z.string()), gaps: z.array(z.string()),
    questionGrades: z.array(z.object({
      questionId: z.string(), score: z.number(), maxScore: z.number(),
      verdict: z.enum(['correct', 'partial', 'incorrect']), feedback: z.string(), evidence: z.array(citation),
    })),
  }),
  writing: z.object({
    score: z.number(), overview: z.string(),
    rubric: z.array(z.object({ criterion: z.string(), score: z.number(), maxScore: z.number(), feedback: z.string() })),
    strengths: z.array(z.string()), improvements: z.array(z.string()), evidence: z.array(citation),
  }),
  connection: z.object({ color: z.enum(['red', 'blue', 'green']), shape: z.enum(['square', 'circle', 'triangle']) }),
};

export type OutputKind = keyof typeof schemas;
export function outputSchema(kind: OutputKind): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(schemas[kind], {
    target: 'draft-7',
    override: ({ jsonSchema }) => {
      // Zod adds safe-integer bounds to .int(). Anthropic rejects numeric
      // constraints on the wire; the shared evaluator enforces them locally.
      delete jsonSchema.minimum;
      delete jsonSchema.maximum;
      delete jsonSchema.exclusiveMinimum;
      delete jsonSchema.exclusiveMaximum;
      delete jsonSchema.multipleOf;
    },
  });
  return schema;
}
