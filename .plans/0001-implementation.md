# whatsapp-conduit implementation plan

Passive, observe-only WhatsApp linked-device bridge: Baileys in, SQLite out.
Built as a sequence of non-stacked PRs, each branched off `main` and merged
after Codex review before the next begins.

## Stack decisions

- Runtime/lang: Node.js + TypeScript (strict).
- Package manager: `pnpm`.
- CLI: `commander`.
- SQLite: `better-sqlite3` (synchronous writes).
- Config: `yaml`.
- Logging: `pino` (message text disabled by default).
- WhatsApp transport: `baileys` (WebSocket only, no browser).
- Tests: `vitest`.

## PR sequence

1. **feat/scaffold-foundations** — package.json, tsconfig (strict), vitest,
   eslint/prettier, .gitignore, LICENSE (MIT), src layout, CLI skeleton
   (`commander`), `doctor` command, logging + time utils. Tests for version
   and redaction-safe logging.
2. **feat/config-and-db** — config loader (YAML + defaults + validation),
   SQLite schema + migration runner, queries layer with idempotent upserts,
   `init`, `db migrate`, `db check`. Tests for config defaults, migrations,
   idempotent persistence.
3. **feat/baileys-connection** — auth state, socket connect with safe
   defaults, reconnect loop, `link`, `run` (connection/logging only), account
   persistence, `status`. Tests for safety invariants (no send/read/online,
   no full history).
4. **feat/ingestion-normalization** — `messages.upsert` handling, message
   normalization across supported types, idempotent persistence, chat/sender
   stubs, chat allow/block filtering at the sync boundary. Tests for
   normalization, duplicates, filtering, no-message-text-in-logs.
5. **feat/cli-and-export** — `chats list/show/allow/block`,
   `messages list`, JSONL `export` with `--since`, `--since-last <consumer>`,
   `--allowed-only`, `--redact-phone-numbers`, consumer offsets +
   two-phase `offsets commit`. Tests for allowed-only exports and offset
   advancement.
6. **feat/service-and-docs** — systemd user unit + `service` commands,
   graceful shutdown, `docs/security.md`, `docs/operations.md`,
   `docs/schema.md`.

## Safety invariants (tested, not just documented)

- Never call `sock.sendMessage()` from ingestion paths.
- Never call `sock.readMessages()` unless an explicit future `mark_read`.
- `markOnlineOnConnect` defaults to `false`.
- `syncFullHistory` defaults to `false`.
- Logs omit message text unless `logging.log_message_text: true`.
- Exports include only allowed chats when `--allowed-only`.
