# AGENTS.md - Coding Agent Guidelines for whatsapp-conduit

`whatsapp-conduit` is a passive, observe-only WhatsApp linked-device bridge:
Baileys in, SQLite out.
Treat this repository as a private personal-inbox ingestion layer, not an AI
agent, chatbot framework, messaging gateway, or WhatsApp Business Cloud API
client.

## Core Rules

- Read `README.md` before making changes.
- Keep the boundary clear: this project syncs and persists; intelligence,
  classification, and replies live in downstream tools (Domovoi/Hermes).
- Ingestion behavior must be deterministic, auditable, and idempotent.
- Default posture is observe-only: do not send, do not mark read, do not mark
  online on connect, do not sync full history, do not download media.
- Treat the Baileys auth directory, the SQLite database, its backups, stored
  media, and message text as sensitive private data.
- Do not commit secrets, auth state, session credentials, local environment
  files, the SQLite DB, or exported message data.
- Do not log message text unless `logging.log_message_text: true` is explicitly
  set.

## Product Boundary

whatsapp-conduit owns the ingestion and local-interface layer:

- link a personal WhatsApp account as a secondary device
- observe selected message events through Baileys
- normalize events into a small SQLite schema
- persist messages, chats, participants, and attachments idempotently
- apply chat allow/block filters at the sync boundary
- maintain sync state and consumer offsets
- expose CLI inspection and deterministic JSONL exports
- run continuously as a foreground process or systemd service

whatsapp-conduit must not:

- send messages from ingestion paths
- mark messages read or mark the account online by default
- call LLMs, classify, summarize, or run open-loop detection
- use a browser/Puppeteer/Selenium driver instead of the Baileys socket
- sync full history, download media, or expose all chats to exports by default
- invent normalized fields when an event cannot be safely parsed

## Preferred Stack

- Node.js + TypeScript (strict) as the runtime and language.
- `pnpm` as the package manager unless project policy says otherwise.
- [Baileys](https://github.com/WhiskeySockets/Baileys) as the only WhatsApp
  transport — its WebSocket WhatsApp Web client, never a browser.
- SQLite for durable local persistence; prefer `better-sqlite3` for simple
  synchronous writes.
- A single CLI framework (e.g. `commander`, `cac`, or `clipanion`).
- YAML config via `yaml`/`js-yaml`.
- `pino` for structured logging, with message text disabled by default.
- `vitest` as the test runner.

## Data Model Principles

- Keep the schema small and migration-friendly.
- Normalize common columns (`text`, `timestamp`, `chat_jid`, `sender_jid`,
  `from_me`, `message_type`) for queries.
- Preserve the raw Baileys payload in `raw_json` when `store_raw_json: true`.
- Prefer explicit loss over invented data: store the raw event and mark
  normalized fields unknown when parsing is unsafe.
- Make message persistence idempotent on `(account_id, chat_jid, message_id)`.

## Planning

- Store implementation plans in `.plans/` at the repo root for work that needs
  a written plan.
- Use repo-relative paths in plan files.
- Commit plan files with the related work when the plan is part of the
  implementation history.

## Code Style

- TypeScript should be strict.
- Prefer named types/interfaces for important data shapes.
- Prefer literal union types over TypeScript `enum`.
- Use `as const` and `satisfies` where they improve type safety.
- Avoid `any`; use precise types or `unknown` with narrowing.
- Use `import type` for type-only imports.
- Use 2-space indentation, double quotes, semicolons, and trailing commas.
- Keep ingestion and normalization logic small, testable, and easy to audit.
- Keep validation close to write boundaries and CLI/command entrypoints.

## Testing

Add focused tests around:

- message normalization across supported types
- idempotent persistence and duplicate handling
- migrations and DB integrity checks
- chat allow/block filtering
- observe-only safety defaults (no send, no read, no message text in logs)
- allowed-only export behavior and consumer offset advancement

## Review Guidelines

When reviewing changes, prioritize correctness and privacy risk over style
preferences already covered by tooling.

Focus on:

- accidental send/read/online/full-history behavior
- message text leaking into logs or non-redacted exports
- chats leaking to exports without an explicit allowlist
- non-idempotent persistence causing duplicates or data loss
- unsafe parsing of Baileys events
- tests missing for changed ingestion or normalization behavior

Use concise findings with exact file and line references. State the impact, the
failure mode, and the smallest reasonable fix.

## Git

- Use Conventional Commits for new commits: `type(scope): short summary`.
- Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.
- Prefer the GitHub REST API and `gh` REST-backed commands wherever possible to
  preserve GraphQL quota for cases that truly require it.
- Only use GitHub GraphQL when the REST API cannot provide the required
  capability or data efficiently.
- When creating a PR, prefer REST-backed `gh api` calls over GraphQL-backed
  commands. Create it as ready for review rather than draft unless the user
  explicitly requests a draft PR, then report the PR URL.
- Keep requested commit boundaries intact when the user asks for multiple
  commits.
- Do not revert user changes unless explicitly asked.
