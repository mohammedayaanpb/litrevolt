# LitRevolt architecture

## Process boundary

LitRevolt uses Electron’s standard privilege split:

```text
React renderer
    │ typed, validated IPC
    ▼
Preload bridge
    │ contextBridge only
    ▼
Electron main process
    ├── SQLite and backups
    ├── managed PDF storage and extraction
    ├── OS credential vault (one entry per provider)
    └── AI evaluation service → Anthropic / OpenAI / Kimi / Gemini adapters
```

The renderer cannot access Node.js, the filesystem, SQLite, or saved API credentials.
It receives only serializable records and requested PDF bytes. The main process
validates all renderer payloads with Zod before applying mutations.

## Storage lifecycle

First launch stores a non-sensitive pointer to the selected data folder under
Electron’s platform user-data directory. The selected folder contains
`litrevolt.db`, encrypted configuration, managed PDFs, backups, and temporary
space. If the selected folder is unavailable at launch, setup is shown rather
than silently creating a second library.

SQLite uses foreign keys and write-ahead logging. Cascades keep paper-dependent
review data coherent. Backups use SQLite’s online backup API after a passive WAL
checkpoint, avoiding an inconsistent raw file copy.

The renderer keeps versioned recovery drafts in localStorage, scoped by paper,
review, reading pass or writing kind, and quiz attempt. Input handlers persist
each edit synchronously to avoid losing a pending debounce on navigation.
Successful saves remove only the matching snapshot, preserving edits made
while an earlier request was pending. Paper deletion clears its recovery keys
after the main-process deletion succeeds. Review deletion clears only that
review's recovery keys, leaving other reviews and papers alone. These recovery copies live in
Electron's local profile and are separate from the selected data folder and
SQLite backups; explicit save actions remain available with visible status.

Library query, project/review filters, sort, and layout live at the application
level so opening a paper or switching screens preserves browsing context for
the current session. They reset when the application restarts.

The Reviews screen has its own session-level search, project/status filters,
and sort. It requests the entire summary collection; the library's recent-review
list remains capped at eight. Each review retains its own optional project
context, independent of later paper membership changes. A review started from
a paper with one project uses that project; otherwise it starts in the general
library. Deleting a project moves its reviews to the general library.

Review names are persisted in SQLite and validated as trimmed strings of 1–200
characters at the IPC and database boundaries. Startup migration 3 assigns
chronological names (Review 1, Review 2, etc.) per paper to older unnamed records
without changing their work or timestamps. See `drizzle/0003_review_names.sql`.
Summary queries select metadata and scores without loading full notes or PDFs.
Review deletion cascades its pass progress, quiz attempts, writing evaluations,
and review-specific annotations; the paper, project memberships, global
annotations, and other reviews are preserved.

Shared review menus support pointer, keyboard, and right-click interaction.
Rename and delete dialogs lock conflicting controls during requests and retain
errors for retry. Successful mutations remain reflected locally if a subsequent
refresh fails, so a refresh error cannot invite duplicate deletion.

The schema is created idempotently at startup and documented in
`drizzle/0001_initial.sql`. The runtime deliberately uses prepared SQL through
`better-sqlite3` so the schema and lifecycle remain transparent in a small
desktop project.

## PDF flow

Import validates the PDF signature, hashes the content for duplicate detection,
extracts page-aware text with PDF.js, and copies the original into managed
storage. Text is stored with `[Page N]` boundaries for local inspection and
searchability detection. The renderer uses PDF.js to render a requested page;
feedback citations update that page directly.

Image-only PDFs remain readable but are excluded from AI review. This avoids
claiming paper-grounded behavior when reliable text extraction is unavailable.

## AI boundary

The main-process `AiEvaluationService` owns prompts, grading rules, structured
output validation, citation checks, local score calculation, and repair logic.
Provider adapters accept instructions, paper content, an output schema, a
model, and token budget, and normalize final text, completion status, and model
identity. Requests go directly to fixed official endpoints through the official
Anthropic, OpenAI, or Google Gen AI SDK; there is no intermediary server or automatic provider
fallback.

| Provider | API | Visual input |
| --- | --- | --- |
| Anthropic | Messages | Base64 PDF |
| OpenAI | Responses | PDF file input |
| Kimi | OpenAI-compatible Chat Completions | Ordered page images |
| Gemini | Native `models.generateContent` | Inline PDF |

Gemini uses `@google/genai` with the fixed
`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
endpoint. It sends the complete PDF inline as `application/pdf`, together with
the canonical page-numbered text and submitted work. It does not upload a
separate file or use stored Interactions. It explicitly sends `store: false` to
disable request logging. Gemini has its own vault entry and
optional `GEMINI_API_KEY` process-environment override, independent of other
providers. The complete serialized Gemini request is capped at 50 million
bytes; this application ceiling does not guarantee model context or quota.

Every provider also receives the normalized, page-numbered text used by local
citation validation. Kimi’s pages are rendered locally through PDF.js/canvas as
white-background PNGs, at up to 2× scale and capped at 2048 pixels on the longest
side. Images remain in memory for the operation and retries. Preparation lives
in the main process, including during closed-book grading, so it does not rely
on exposing the paper through the renderer. Document/request limits reject an
oversize complete paper without dropping pages or falling back to text-only.

Settings hold one active provider and separate model configuration per provider.
Anthropic’s workspace header is specific to its adapter. Each operation captures
its provider, model, and credentials before asynchronous work; retries retain
that configuration if Settings changes. Connection tests instead use the full
unsaved configuration submitted by the settings form and small synthetic
visual/JSON content. Their status is transient and cleared by edits or switching
providers; it is not a grading-quality certification.

Existing Anthropic model/workspace configuration and credential migration are
preserved. New quiz generation, quiz grading, and writing evaluations store
nullable provider/model/document-mode metadata. Historical provenance is unknown
rather than inferred from current settings.

The system prompt forbids unsupported sources and requires structured JSON.
Local schemas reject malformed scores, missing evidence, invalid page numbers,
and unexpected enum values before anything is saved. Refusals, incomplete
responses, and failed local validation cannot become saved grades.

Quiz questions are saved before answers exist. During an ungraded attempt the
renderer hides the PDF. Submitted answers are saved before the API request so
an unsuccessful grading request can be retried after restarting. Grading stores the submitted answers, per-question
verdicts, feedback, evidence quotes, pages, and total score in a single attempt.

## Workflow invariants

- Pass 1 is initially available; Passes 2 and 3 are locked.
- A pass cannot complete without a submitted, graded quiz.
- Completing a pass unlocks exactly the next pass.
- Summary and critical-review work is unavailable until all passes complete.
- A review is complete only after all three quizzes and both writing evaluations
  have numeric scores.
- Understanding totals are calculated locally from saved component scores.
- An active quiz hides notes, feedback, and the source in other reviews of that
  paper. Opening one shows a resume-quiz gate. Review results synchronize the
  paper's quiz state with the application library before sidebar navigation.

These rules are enforced in the main-process services/database, not only by UI
state.

## Failure behavior

Filesystem, SQLite, credential, API, parsing, and validation failures propagate
as explicit renderer messages. A failed AI evaluation is not saved as a grade;
submitted quiz answers and writing drafts remain available for retry.
An imported managed PDF is removed if its database insert fails. A paper file is
removed only after its resolved path is verified to be inside managed storage.
