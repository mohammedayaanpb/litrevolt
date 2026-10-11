# LitRevolt

**Read deeper. Think critically. Review with purpose.**

LitRevolt is an open-source desktop application that guides researchers
through S. Keshav’s three-pass method for reading academic papers.

Instead of merely summarizing a paper for the reader, LitRevolt tests and
evaluates the reader’s own understanding through closed-book quizzes,
paper-specific writing rubrics, evidence-linked feedback, and a final
understanding score.

> LitRevolt is designed to answer **“How well did I understand this paper?”**
> rather than only **“What does this paper say?”**

LitRevolt is a personal, local-first desktop tool. Your library, projects,
annotations, reviews, and scores are stored on your computer. AI-powered
actions use your own Anthropic, OpenAI, Kimi, or Gemini API key and send requests
directly from LitRevolt to your selected provider; the project operates no intermediary
server.

You can import, read, annotate, organize, and back up papers without an API key.
AI quizzes and writing evaluation require internet access and your own provider
account; API charges may apply.

## What the MVP does

- Imports searchable academic PDFs into a managed local library.
- Organizes papers in a general library and reusable projects.
- Enforces Pass 1 → Pass 2 → Pass 3 in sequence.
- Provides pass-specific prompts based on Keshav’s reading method.
- Generates paper-specific, closed-book quizzes with your selected AI provider.
- Hides the source during retrieval and grades every answer against the paper.
- Explains weak or incorrect answers with clickable page citations.
- Stores page notes and evidence highlights locally.
- Evaluates the reader’s summary and critical review with separate rubrics.
- Computes an evidence-based understanding score only after all components exist.
- Stores each provider’s API key separately in the operating system credential vault.
- Creates consistent, timestamped SQLite backups.
- Includes Electron Forge packaging targets for Windows, macOS, and Linux.
- Preserves library filters while browsing, offers grid/list views and sorting,
  and puts unfinished reviews within reach.
- A dedicated Reviews tab shows the full review collection, with search, project
  or general-library filters, status filters, and sorting. Use a review's
  three-dot menu or right-click it to rename or delete it, including in paper
  details. Deleting a review keeps the paper and its other reviews.
- Keeps local recovery drafts while typing notes, quiz answers, and writing.
  Use Save notes / Save draft to include them in the review database and backups;
  recovery copies live in the app's local profile. See [Privacy](docs/PRIVACY.md).

## The three-pass workflow

1. **Survey the landscape.** Identify category, context, contribution,
   surface validity, and clarity; then test first-pass recall.
2. **Trace the argument.** Inspect methods, figures, evidence, and assumptions;
   then answer a deeper paper-specific quiz.
3. **Reconstruct and challenge.** Re-create the work independently, identify
   limitations, plan replication, and derive new directions before the final quiz.
4. **Synthesize and critique.** Write your own summary and critical review.
   LitRevolt evaluates both against the source and preserves cited feedback.

The method is based on S. Keshav’s paper, [How to Read a Paper](https://cs.uwaterloo.ca/~Brecht/courses/856/readings/how-to-read/keshav-paper-reading.pdf).
This independent project does not imply Keshav’s endorsement.

## Understanding score

LitRevolt combines five paper-grounded evidence sources:

| Evidence | Weight |
| --- | ---: |
| Pass 1 quiz | 15 points |
| Pass 2 quiz | 20 points |
| Pass 3 quiz | 25 points |
| Written summary | 20 points |
| Critical review | 20 points |

A component contributes zero until it has been submitted and evaluated. The UI
labels an incomplete total as work in progress rather than presenting it as a
finished measure. See [Scoring and evaluation](docs/SCORING.md) for the rationale.

## Install and run from source

LitRevolt is an early desktop release. The instructions below build and run it
from this repository; they do not require a hosted service or a shared API key.

Requirements:

- Git.
- Node.js 24 and npm (used to install pnpm).
- pnpm 11.9.0, matching the repository's package manager and lockfile.
- Python 3 and native C/C++ build tools for Electron dependencies:
  - **Windows:** Visual Studio Build Tools with **Desktop development with C++**.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux:** `make` and a C/C++ compiler such as GCC.
- A desktop session with an operating system credential vault if you want to
  save an API key.

```bash
git clone https://github.com/mohammedayaanpb/litrevolt.git
cd litrevolt
npm install --global pnpm@11.9.0
pnpm install --frozen-lockfile
pnpm start
```

`pnpm install --frozen-lockfile` installs the versions in `pnpm-lock.yaml`.
The repository configures the hoisted dependency layout needed by Electron
Forge and permits required native dependency build scripts. Installation downloads
Electron and may build native modules; allow dependency install scripts to run.
If Windows PowerShell blocks script launchers, use `npm.cmd` and `pnpm.cmd` in
place of `npm` and `pnpm` in these commands.

### First launch and your first paper

1. Read and acknowledge the privacy notice, then choose a folder for your local
   LitRevolt data. Keep this folder outside your source checkout.
2. Select an AI provider and model. You can leave its API key blank and add it
   later in **Settings**.
3. In **Library**, choose **Import PDF** and select a paper. LitRevolt keeps a
   managed copy in your data folder.
4. Open the paper to read, annotate, or assign it to a project. For a searchable
   PDF, choose **Start a review** and work through the three passes in order.
5. Before generating a quiz or evaluating writing, add your own provider key
   in **Settings**, save it, and activate the provider. **Test connection**
   verifies access with synthetic content and may incur a small API charge.

Use **Reviews** to resume unfinished reviews or revisit completed ones. Save
notes and drafts before making a database backup.

### Build a desktop package or installer

```bash
pnpm check       # TypeScript plus unit/integration tests
pnpm build       # Production Electron application under out/
pnpm make        # Platform installer/archive under out/make/
```

Build on the operating system you intend to distribute for:

| Build host | Configured output | Additional packaging tools |
| --- | --- | --- |
| Windows | `LitRevolt-Setup.exe` and ZIP | Windows build environment above |
| macOS | ZIP containing the application | macOS build environment above |
| Linux | DEB and RPM | `fakeroot`, `dpkg`, and `rpm`/`rpmbuild` |

Platform targets describe the packaging configuration, not a guarantee of
runtime validation on every OS or architecture. The offline test suite and
Windows production package were verified for this source release. Signing and
notarization are not configured; see [Branding and platform icons](#branding-and-platform-icons)
before preparing a release.

An optional [GitHub Actions template](docs/github-actions-ci.yml) runs checks
and a production package build on Ubuntu. Automated GitHub builds are not yet
enabled. To enable them, copy the template to `.github/workflows/ci.yml` and
commit that file with a credential permitted to publish workflows (OAuth tokens
need the `workflow` scope). This checkout ignores that active path, so add it
explicitly with `git add -f .github/workflows/ci.yml`.

If a native dependency fails to compile, verify Python and the platform's C++
toolchain first. If saving a key fails, check that your OS credential vault is
available; LitRevolt will not save the key as plaintext instead.

### AI provider settings

| Provider | Default model preset | Paper input |
| --- | --- | --- |
| Anthropic | `claude-sonnet-5` | PDF and page-numbered text |
| OpenAI | `gpt-6-sol` | PDF and page-numbered text |
| Kimi | `kimi-k3` | Images of every PDF page and page-numbered text |
| Gemini | `gemini-3.8-flash` | PDF and page-numbered text |

These are configurable presets, not a claim that a model is available to every
account or has been evaluated for grading quality. Choose **Custom model ID
(advanced)** to enter another model from the selected provider. It must support
visual input and structured JSON responses. Custom endpoints and arbitrary
provider APIs are not supported in this release.

Gemini uses Google’s native API directly with your own Gemini API key. Model
availability and free quotas depend on your account; LitRevolt does not
guarantee free grading. Google’s unpaid service may use submitted content and
responses to improve its products. Review the [Gemini API terms](https://ai.google.dev/gemini-api/terms)
and [billing guidance](https://ai.google.dev/gemini-api/docs/billing) before sending private research.

In Settings, choose a provider and model, enter its key, and use **Test
connection**. The test uses the currently entered model, workspace, and key (or
that provider’s saved key), so preferences need not be saved first. It sends a
small synthetic visual/JSON request, never a library paper, and can incur usage
charges. A successful test checks access and response handling; it does not
establish grading accuracy.

**Save key** stores only the selected provider’s key. In the AI connection card,
choose **Use Gemini** (or the selected provider) to activate it, or **Save AI
settings** to apply changes to the active model and workspace. A pending notice
shows which provider and model requests still use. Testing a connection does not
activate the selection or save an entered key. **Save preferences** also saves
all model choices and activates the selected provider. Model drafts are kept
separately while switching providers; an entered, unsaved key is cleared on
switch. Existing installations keep Anthropic, their model selection, and their
saved key. A request and its retries use the provider/model captured when it
starts; failures never trigger an automatic switch to another provider.

If Anthropic reports that your API key is not scoped to a workspace, enter the
workspace ID in Settings → AI connection. The test uses the entered value;
choose **Save AI settings** to apply it to future reviews. Workspace-scoped keys can leave this field blank. Find the ID in
Claude Console → Settings → Workspaces; see [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication).

For development or managed deployments, the process environment can provide
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `KIMI_API_KEY` (or `MOONSHOT_API_KEY`), and
`GEMINI_API_KEY`. Each overrides only that provider's saved key; select the active
provider in Settings. See [`.env.example`](.env.example) for variable names.
LitRevolt does **not** automatically load `.env` files. Enter keys in the app or
inject them through your local secret-management mechanism, and never commit
real credentials.

Tests use mocked API transports and generated PDFs by default. See
[AI provider validation](docs/AI_VALIDATION.md) for the explicitly enabled live
benchmark, grading-quality checks, and document/request limits. A successful
connection check does not establish grading quality or equal scores across models.

## Local data layout

The folder selected during first launch contains:

```text
<selected-data-folder>/
├── litrevolt.db
├── config/
│   └── litrevolt-config.enc
├── papers/
├── backups/
│   └── litrevolt-backup-YYYY-MM-DD-HHmmss.db
└── temp/
```

`litrevolt.db` is SQLite. Managed PDF filenames use internal identifiers so
duplicate and unusual source filenames cannot collide. Deleting a paper requires
confirmation and removes its managed copy and dependent LitRevolt records.

Built-in backups contain the database only, not the managed PDFs, operating
system credentials, or unsaved recovery drafts. Keep a separate backup of your
full data folder if you need to preserve the PDF library. Recovery drafts live
in Electron's local user-data profile; **Save notes** and **Save draft** commit
them to the database.

## Privacy and security

LitRevolt has no accounts, telemetry, remote database, collaboration layer,
subscription, or application backend. When you explicitly generate or grade a
quiz or evaluate writing, the paper, page-numbered text, and submitted work are
sent directly to the selected provider. Anthropic, OpenAI, and Gemini receive the PDF;
Kimi receives locally rendered images of every page. The selected provider’s
terms and usage charges apply to the API key owner.

The renderer has no Node.js access. Electron context isolation and sandboxing
are enabled, IPC inputs are validated, external navigation is restricted to
HTTPS, and saved API keys never enter renderer-visible settings or SQLite. See
[Privacy](docs/PRIVACY.md) and [Security](SECURITY.md).

## Searchable PDF requirement

LitRevolt detects whether useful text can be extracted during import. A scanned
or image-only PDF can still be read and annotated, but AI quizzes and writing
evaluation remain disabled because evidence cannot be reliably grounded. AI
requests enforce provider-specific document and request limits. If the full
paper cannot fit, the operation fails with a message; it never silently drops
pages or switches to text-only input. OCR is not included.

## Architecture

- **Electron main process:** lifecycle, file dialogs, local storage, SQLite,
  credential vault access, PDF extraction/rendering, backups, and provider requests.
- **Preload bridge:** a narrow, typed IPC API exposed through context isolation.
- **React renderer:** onboarding, library/projects, PDF reading, sequential pass
  workflow, review browsing/management, closed-book quiz mode, writing evaluation,
  and score visualization.
- **Shared domain layer:** serializable types, pass guidance, and deterministic
  score calculation.

Read [Architecture](docs/ARCHITECTURE.md) for process boundaries, schema details,
failure behavior, and design decisions.

## Branding and platform icons

Original source assets are committed in `assets/branding/`:

- `litrevolt-logo.svg` — primary wordmark
- `litrevolt-icon.svg` — compact application mark
- `litrevolt-mark-monochrome.svg` — single-color mark

The SVG icon is suitable for development. Before a signed release, generate a
multi-resolution Windows `.ico`, macOS `.icns`, and Linux PNG set from
`litrevolt-icon.svg` (for example with ImageMagick plus `png2icons`), place them
under `assets/branding/platform/`, and set `packagerConfig.icon` in
`forge.config.ts` to the extensionless platform asset path. Verify at 16, 32,
64, 128, 256, 512, and 1024 px.

## Open-source status and attribution

LitRevolt is released under the [MIT License](LICENSE) and is an independent
open-source project. It is not affiliated with or endorsed by S. Keshav,
Anthropic, OpenAI, Moonshot AI, Google, TeachPaper, or another research application.
Optional AI features use the official Anthropic TypeScript SDK and the official
OpenAI SDK, including Kimi’s OpenAI-compatible API, plus the official Google
Gen AI SDK for Gemini’s native API.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
an issue or pull request.
