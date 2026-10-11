# LitRevolt privacy notice

## How LitRevolt handles your data

LitRevolt stores its database and managed PDF copies locally in the data folder
you select.

When you use an AI-powered feature, LitRevolt sends the paper, page-numbered
extracted text, and your submitted answers or writing directly to the provider
you selected in Settings, using its API key. Anthropic, OpenAI, and Gemini receive the
PDF; Kimi receives locally rendered images of every page. Images stay in memory
for the operation and its retries. Searchable text is required for evidence
checks; image-only papers cannot use AI review.
The LitRevolt project does not operate an intermediary server and does not
receive your papers, reviews, or API key.

API usage is subject to the selected provider’s terms and is billed to the
account associated with that provider’s API key. LitRevolt does not
automatically send failed requests to a different provider. A provider/model
change applies to later operations; an operation already running keeps its
original configuration through retries.

Gemini requests send the complete PDF and the same page-numbered text directly
to Google’s Gemini API. LitRevolt uses inline content and does not create a
remote file upload or stored interaction. Requests set `store: false` to opt out
of API request logging; this does not override Google’s data-use terms.
Google’s unpaid service may use
submitted content and responses to improve its products; handling depends on
the applicable account and regional terms. Model access and free quotas depend
on your account, and free grading is not guaranteed. Review the
[Gemini API terms](https://ai.google.dev/gemini-api/terms) and
[billing guidance](https://ai.google.dev/gemini-api/docs/billing) before sending private research.

## Local records

The local SQLite database contains paper metadata and extracted text, project
membership, pass notes, quiz questions and responses, paper-grounded grading,
review names, written work, rubric feedback, annotations, scores, and the
provider/model/document mode used for new AI results. Historical results may
have unknown provenance. Managed PDF copies and
timestamped database backups live alongside it in the selected data folder.

While you type, recovery copies of reading notes, quiz answers, and writing are
kept in the app's local browser storage inside Electron's user-data profile on
this computer. They survive navigation and restarts of the same app, and are
removed after the matching version is saved or submitted successfully. They
are not included in SQLite backups; use **Save notes** or **Save draft** to
include your work in the review database. Storage failures are shown beside
the editor. Drafts are never sent to an AI service just by typing.

API keys are excluded from SQLite and kept in separate entries in the operating
system credential vault. Saved keys are never returned to the renderer; a key
typed into setup or Settings is sent only to the main process for saving or
testing. Unsaved keys are cleared from the form when you switch providers.
`config/litrevolt-config.enc` contains only a non-secret version marker.
Readable legacy encrypted keys are migrated to the vault once. The optional
Anthropic workspace ID is stored in local settings and sent only to Anthropic
with API requests.

## Network behavior

No network request is needed to import, read, annotate, organize, or back up a
paper. **Test connection** sends a small synthetic visual/JSON request to the
selected provider using the configuration entered in Settings. It sends no
user paper and can incur API usage charges. The result is temporary connection
status, not a measure of grading accuracy.

Network access occurs only for an explicit AI action, a connection test, or when the user
opens the GitHub link from the About screen. LitRevolt contains no analytics or
telemetry.

## Deletion

Removing a paper after confirmation deletes its managed PDF and cascades its
reviews, quiz attempts, evaluations, notes, and highlights from the active
database. Existing backup files are immutable snapshots and may still contain
older records; delete those local backup files separately when required.
The app also clears that paper's local recovery drafts after successful
deletion and reports if local storage could not be cleared.

Deleting an individual review after confirmation removes its notes, quiz
answers, writing, evaluations, and review-specific highlights, plus that
review's local recovery copies. The source PDF, paper-wide annotations,
project memberships, and other reviews remain available. Renaming and deleting
reviews are local actions and do not call an AI provider. Existing backups can still
contain deleted reviews.
