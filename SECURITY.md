# LitRevolt security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose API
keys, papers, or local research data. Use GitHub’s private vulnerability
reporting for [mohammedayaanpb/litrevolt](https://github.com/mohammedayaanpb/litrevolt/security/advisories/new).

Include the affected version, platform, reproduction steps, impact, and any
suggested mitigation. Do not include a real API key or confidential
paper in the report.

## Security model

LitRevolt is a local desktop application, not a trust boundary against someone
who already controls the user’s operating-system account. It nevertheless:

- stores each AI provider’s key separately in the operating system credential vault;
- migrates readable legacy Electron `safeStorage` keys without a plaintext fallback;
- keeps Node.js disabled in the renderer;
- enables context isolation and renderer sandboxing;
- exposes a narrow preload API and validates IPC payloads in the main process;
- restricts external navigation to HTTPS;
- copies imported papers into an application-managed directory; and
- verifies managed paths before removing PDF files.

AI requests send the relevant paper, extracted text, and reader submission
directly to the selected provider: Anthropic, OpenAI, Kimi, or Gemini. Anthropic,
OpenAI, and Gemini receive the PDF; Kimi receives images rendered from every page. Users
should evaluate their selected provider’s data-handling terms for their papers.
Providers use fixed official endpoints; custom endpoints and automatic fallback
to another provider are not supported. Saved credentials never return through
IPC. Connection tests use synthetic content, not library papers. Diagnostic
records must exclude prompts, document content, credentials, and raw provider
response bodies.

Gemini uses the fixed Google `generativelanguage.googleapis.com` endpoint with
inline PDF content, without separate file uploads or stored Interactions.
Google’s unpaid-service data terms can differ from paid-service terms; see the
[Gemini API terms](https://ai.google.dev/gemini-api/terms) before submitting private research.
