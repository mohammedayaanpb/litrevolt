# Contributing to LitRevolt

Thanks for helping researchers read more actively. LitRevolt welcomes focused
bug fixes, tests, accessibility improvements, documentation, and carefully
scoped feature proposals.

## Development setup

1. Install Node.js 24 and pnpm 11.9.0 (`npm install --global pnpm@11.9.0`).
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run check`.
4. Start the desktop app with `pnpm start`.

Before submitting a pull request, run both `pnpm run check` and `pnpm run build`.
Native dependency packaging is part of correctness for an Electron application.

## Design constraints

- Keep the three passes sequential. Do not turn LitRevolt into an automatic
  summarizer or reveal the PDF during a closed-book quiz.
- Keep papers, reviews, annotations, projects, and scores local.
- Never log, persist in SQLite, or return a saved API key to the renderer.
- Keep credentials and settings isolated by provider; never add automatic
  fallback that sends a paper to a different provider.
- Keep prompts, citation validation, repair logic, and scoring in the shared AI
  evaluation service. Provider adapters handle transport and response normalization.
- Include the complete visual document and the same page-numbered text used by
  citation validation. Reject oversize inputs; never silently omit pages.
- Validate every new IPC input in the main process.
- Preserve page-level evidence links for AI feedback.
- Keep scoring deterministic and explain any proposed weight change.
- Use **LitRevolt** for user-facing text and `litrevolt` for technical identifiers.

## Pull requests

Keep changes small enough to review. Include:

- the user problem and intended behavior;
- screenshots for visible UI changes;
- tests for domain, database, or workflow behavior;
- privacy/security impact when paper content or credentials are involved; and
- successful `pnpm run check` and `pnpm run build` output.

Do not include real API keys, private papers, generated user databases, or
managed data directories in fixtures.

## Provider validation

Run shared evaluation tests with each provider adapter and test authentication,
request limits, truncation/refusal handling, citation validation, credential
isolation, configuration changes during a request, and submission recovery.
Connection tests use a small synthetic visual/JSON request and do not establish
grading quality. Before describing a provider/model as verified, explicitly opt
into a live evaluation set covering figures, equations, tables, and known
incorrect answers. Assess grounded feedback and citation correctness; do not
require identical numerical scores from different models. Record the provider,
model, evaluation date, cases, and results. Mocked tests alone do not justify a
claim of live compatibility or quality.

The optional [live benchmark](docs/AI_VALIDATION.md) accepts Anthropic, OpenAI,
Kimi, and Gemini through an explicit per-run provider selection. It uses only
synthetic content and supplied test credentials. For Gemini, preserve native
inline PDF input and isolated credentials, and document quota limits without
promising free access or free grading.
