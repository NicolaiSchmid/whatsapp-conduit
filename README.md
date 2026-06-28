# whatsapp-conduit

> **A passive, observe-only WhatsApp conduit for personal agents: Baileys in, SQLite out — without turning your account into a bot.**

`whatsapp-conduit` is a small, channel-specific bridge for one job: connect to a WhatsApp account through the linked-device protocol, listen to message events through [Baileys](https://github.com/WhiskeySockets/Baileys), and persist a normalized local copy into SQLite.

It is **not** an AI agent.  
It is **not** an open-loop tracker.  
It is **not** a customer-support bot.  
It is **not** a WhatsApp Business Cloud API wrapper.  
It is **not** a browser automation harness.

It is the boring, auditable ingestion layer that other tools can safely build on top of.

---

## Name brainstorm

This repository is now named **`whatsapp-conduit`**. “Conduit” is the intended metaphor: a narrow, local, inspectable channel between a personal WhatsApp linked-device session and downstream tools such as Domovoi/Hermes. Before creating the GitHub repository, earlier candidate names included:

### Top candidates

| Name | Why it works | Tradeoff |
|---|---|---|
| **`whatsapp-conduit`** | Strong metaphor: a passive local channel/interface from WhatsApp to SQLite/agents | Longer than `wa-*`, but clearer |
| **`whatsapp-sqlite-sync`** | Extremely explicit; good for search/discovery | Long repo/command name |
| **`wa-sqlite`** | Short and precise | Sounds like a library more than a daemon |
| **`whatsapp-inbox-sync`** | Captures the personal-inbox framing | Longer; maybe too product-y |
| **`wa-inbox`** | Short, memorable, personal-inbox oriented | Less explicit about SQLite/sync |

### More expressive alternatives

| Name | Notes |
|---|---|
| `watap` | Cute, but maybe too obscure |
| `greenline` | Evokes WhatsApp green + message line, but not descriptive |
| `chatledger-wa` | Strong “local record” framing; more formal |
| `inbox-bridge-wa` | Clear but a bit clunky |
| `warchive` | WhatsApp archive; memorable, but sounds archive-only |
| `wastore` | WhatsApp store; concise, but could collide conceptually with “WA Store” |
| `waha-lite` | Avoid; too close to existing WAHA project naming |
| `wa-observer` | Correct observe-only framing, but less about persistence |
| `wa-journal` | Nice personal-log framing, less technical |
| `msgmirror-wa` | Descriptive, but “mirror” may imply too much historical sync |

### Current recommendation

Use **`whatsapp-conduit`** for both the repo and binary. It is explicit enough for humans, avoids bot semantics, and leaves room for the project to expose a controlled interface rather than merely a mirror/archive.

Suggested GitHub repo:

```text
NicolaiSchmid/whatsapp-conduit
```

Suggested package/binary naming:

```bash
whatsapp-conduit link
whatsapp-conduit run
whatsapp-conduit chats list
whatsapp-conduit messages export --since 24h --format jsonl
```

---

## Why this project exists

Most WhatsApp “AI bot” integrations start from the wrong premise for personal automation:

```text
User sends message to bot → bot thinks → bot replies in the same chat
```

That is the right shape for a support bot or a dedicated assistant phone number. It is the wrong shape for a private personal inbox.

This project starts from a different premise:

```text
Nicolai uses WhatsApp normally with friends/family/work
        ↓
A linked-device bridge observes selected message events
        ↓
Messages are normalized into a local SQLite database
        ↓
Other tools can query/export/summarize/detect tasks later
```

The core separation is:

> **Sync first. Intelligence later. Sending maybe never.**

`whatsapp-conduit` exists to be the safe boundary between WhatsApp’s linked-device event stream and downstream personal tooling.

---

## Do we actually need this?

The current answer is **yes, if the requirement is a passive personal-account interface for Domovoi/Hermes rather than a WhatsApp chat surface for Hermes itself**.

This should remain an explicit design assumption to revisit as Hermes and Baileys evolve.

### Why not just use Hermes' stock WhatsApp gateway?

Hermes already has a WhatsApp integration, and it is useful. But its documented product shape is the gateway/bot shape:

- a separate bot number, or
- personal self-chat where the owner messages themselves to talk to the agent.

That is different from the desired shape here:

```text
Nicolai's normal WhatsApp conversations
        ↓
local passive conduit
        ↓
Domovoi/Hermes can inspect/query/export context
        ↓
no automatic in-band reply
```

The stock gateway also routes inbound messages into Hermes conversation sessions and owns the response loop. That is exactly what a messaging gateway should do, but it is the wrong primitive for a private inbox conduit.

### Why not configure Baileys directly and call it done?

Baileys provides the hard transport primitive: a linked-device WhatsApp Web socket and event hooks such as message upserts. It does not, by itself, provide the product boundary we want:

- SQLite schema and migrations
- idempotent message persistence
- chat allow/block policy
- consumer offsets for downstream tools
- JSONL export contracts
- no-message-text logging defaults
- operational service wrapper
- clear observe-only/no-read/no-send guardrails

So this project should be small, but it is still a real project: Baileys is the transport; `whatsapp-conduit` is the local interface and persistence layer.

### Decision rule

Use stock Hermes WhatsApp if the goal is:

```text
message Hermes on WhatsApp and receive replies in WhatsApp
```

Use `whatsapp-conduit` if the goal is:

```text
let Domovoi/Hermes access Nicolai's WhatsApp context through a local, passive, auditable interface
```

---

## Goals

### Primary goal

Create a dependable, inspectable, local WhatsApp → SQLite sync bridge for a personal WhatsApp account.

### Product goals

- **Observe-only by default** — receive and store messages; do not reply.
- **No read receipts by default** — do not call `sock.readMessages()` unless explicitly configured later.
- **No online presence by default** — use Baileys configuration such as `markOnlineOnConnect: false`.
- **No browser** — use Baileys’ WebSocket-based WhatsApp Web protocol client, not Puppeteer/Selenium/Chromium.
- **SQLite-first** — durable local persistence with a simple schema and straightforward backups.
- **CLI-first** — everything important can be linked, run, inspected, exported, and debugged from the terminal.
- **LLM-agnostic** — this project does not call LLMs, run open-loop detection, or know about Hermes internals.
- **Auditable** — clear config, clear logs, clear database tables, clear boundaries around sensitive data.
- **Composable** — downstream tools can consume the SQLite DB or JSONL exports.

### Non-goals

`whatsapp-conduit` intentionally does **not** aim to be:

- a WhatsApp chatbot framework
- a Hermes Agent gateway adapter
- an OpenClaw replacement
- an open-loop tracker
- an inbox zero product
- a CRM
- a team/customer-support tool
- a WhatsApp Business Cloud API client
- a message-sending automation framework
- a generic multi-channel personal inbox system

Those can be separate projects. This one is WhatsApp-only and sync-only.

---

## Design principles

### 1. Passive before active

The first working version should not expose a sending path at all, or should hide it behind an intentionally scary flag. Reading and writing are different trust domains.

Default posture:

```yaml
observe_only: true
send_enabled: false
mark_read: false
mark_online_on_connect: false
sync_full_history: false
```

### 2. Personal account, not bot account

This project is intended for a real personal WhatsApp account linked as a secondary device.

That means the correct mental model is:

```text
whatsapp-conduit acts on behalf of the account owner as a private local sync process.
```

Not:

```text
whatsapp-conduit is a bot that other people intentionally message.
```

### 3. Store raw enough, query cleanly

The SQLite database should include normalized columns for common queries, while preserving enough raw event JSON to recover from parser gaps.

Example:

- normalized `text`, `timestamp`, `chat_jid`, `sender_jid`, `from_me`
- raw Baileys message/event JSON in a `raw_json` column or side table

### 4. Prefer explicit loss over surprising behavior

If the bridge cannot safely parse something, it should store the raw event and mark the normalized fields as unknown, rather than inventing data.

### 5. No hidden AI

No LLM calls inside this project. No classification. No summaries. No “smart” behavior. The bridge should be boring infrastructure.

### 6. Local-first, private-by-default

The first version should store everything locally. No cloud dashboard. No telemetry. No remote logging. No hosted dependency beyond WhatsApp itself.

---

## Relationship to Baileys

[Baileys](https://github.com/WhiskeySockets/Baileys) is the upstream WhatsApp Web protocol client.

Baileys provides:

- linked-device authentication via QR/pairing-code flows
- direct WebSocket communication with WhatsApp Web, without a browser
- event emitters for messages, receipts, chats, contacts, groups, connection updates, and more
- media download helpers
- send APIs, which this project avoids by default

This project provides the pieces Baileys deliberately does not try to be:

- durable SQLite message store
- schema migrations
- safe observe-only defaults
- CLI and service wrapper
- chat allow/block filtering
- deterministic exports for downstream systems
- operational docs and systemd packaging

Baileys docs:

- GitHub: <https://github.com/WhiskeySockets/Baileys>
- Docs: <https://baileys.wiki/>
- Introduction: <https://baileys.wiki/docs/intro/>

Important caveat: Baileys is unofficial and is not affiliated with WhatsApp. Use it at your own discretion.

---

## Architecture

```text
┌──────────────────────────┐
│ WhatsApp mobile account  │
└─────────────┬────────────┘
              │ Linked Devices
              ▼
┌──────────────────────────┐
│ Baileys WebSocket client │
│ - QR/pairing auth        │
│ - messages.upsert        │
│ - chats/contacts events  │
└─────────────┬────────────┘
              │ event stream
              ▼
┌──────────────────────────┐
│ whatsapp-conduit daemon           │
│ - normalize events       │
│ - apply chat filters     │
│ - persist idempotently   │
│ - maintain sync state    │
└─────────────┬────────────┘
              │ SQLite writes
              ▼
┌──────────────────────────┐
│ whatsapp-conduit.db               │
│ - accounts               │
│ - chats                  │
│ - participants           │
│ - messages               │
│ - attachments            │
│ - events/raw             │
│ - sync_state             │
└─────────────┬────────────┘
              │ CLI / JSON / JSONL
              ▼
┌──────────────────────────┐
│ Downstream consumers     │
│ - Hermes cron            │
│ - scripts                │
│ - notebooks              │
│ - backup/export tools    │
└──────────────────────────┘
```

---

## Intended user stories

### Personal WhatsApp sync

> As Nicolai, I want a local SQLite mirror of selected WhatsApp chats so that trusted local tools can reason over my messages without connecting directly to WhatsApp.

### Safe assistant ingestion

> As Nicolai, I want Domovoi/Hermes to be able to inspect recent WhatsApp messages through a controlled DB/export layer, not through an auto-reply gateway.

### Auditability

> As Nicolai, I want to see exactly what was ingested, what was ignored, and when sync state changed.

### No notification swallowing

> As Nicolai, I want to avoid the old browser-driven OpenClaw failure mode where a WhatsApp Web tab appeared active and swallowed notifications/read state.

### Future open-loop consumption

> As a downstream project, I want a clean `messages export --since-last` interface so I can build reminders, summaries, or open-loop scanners without touching Baileys directly.

---

## CLI sketch

The first stable CLI should feel like this:

```bash
# Show version and environment
whatsapp-conduit doctor

# Create config and data directories
whatsapp-conduit init

# Link WhatsApp as a secondary device via QR code
whatsapp-conduit link

# Run the foreground sync daemon
whatsapp-conduit run

# List known chats
whatsapp-conduit chats list

# Show one chat's metadata
whatsapp-conduit chats show <chat-jid>

# Allow or block chats at the sync/filter layer
whatsapp-conduit chats allow <chat-jid>
whatsapp-conduit chats block <chat-jid>

# Inspect recent messages
whatsapp-conduit messages list --chat <chat-jid> --limit 50
whatsapp-conduit messages list --since 24h

# Export for downstream tools
whatsapp-conduit export --since 24h --format jsonl
whatsapp-conduit export --since-last consumer-name --format jsonl

# Show daemon/sync state
whatsapp-conduit status

# Validate DB schema and integrity
whatsapp-conduit db check

# Run migrations
whatsapp-conduit db migrate
```

Possible service commands later:

```bash
whatsapp-conduit service install --user
whatsapp-conduit service start
whatsapp-conduit service status
whatsapp-conduit service logs
```

---

## Configuration sketch

Default config path:

```text
~/.config/whatsapp-conduit/config.yaml
```

Alternative explicit path:

```bash
whatsapp-conduit --config /srv/agents-state/nicolai/whatsapp-conduit/config.yaml run
```

Example config:

```yaml
account:
  name: personal
  description: "Nicolai's personal WhatsApp linked-device sync"

paths:
  data_dir: /srv/agents-state/nicolai/whatsapp-conduit
  sqlite: /srv/agents-state/nicolai/whatsapp-conduit/whatsapp-conduit.db
  auth_dir: /srv/agents-state/nicolai/whatsapp-conduit/auth
  media_dir: /srv/agents-state/nicolai/whatsapp-conduit/media

baileys:
  print_qr_in_terminal: true
  sync_full_history: false
  mark_online_on_connect: false
  browser_name: whatsapp-conduit

privacy:
  observe_only: true
  send_enabled: false
  mark_read: false
  store_message_text: true
  store_raw_json: true
  store_media: false
  include_groups: false
  include_status: false

filters:
  # Empty allowlist means discover chats but do not expose all chats to exports by default.
  allowed_chats: []
  blocked_chats: []
  allowed_senders: []
  blocked_senders: []

exports:
  default_format: jsonl
  redact_phone_numbers: false
  include_raw_json: false

logging:
  level: info
  log_message_text: false
```

---

## SQLite schema sketch

The schema should be small and migration-friendly.

### `accounts`

One database may eventually hold multiple linked WhatsApp accounts, though MVP can support one.

```sql
create table accounts (
  id text primary key,
  label text,
  self_jid text,
  phone_number text,
  created_at integer not null,
  updated_at integer not null
);
```

### `chats`

```sql
create table chats (
  account_id text not null,
  jid text not null,
  name text,
  push_name text,
  is_group integer not null default 0,
  is_status integer not null default 0,
  is_blocked integer not null default 0,
  is_allowed integer not null default 0,
  discovered_at integer not null,
  updated_at integer not null,
  last_message_ts integer,
  raw_json text,
  primary key (account_id, jid),
  foreign key (account_id) references accounts(id)
);
```

### `participants`

```sql
create table participants (
  account_id text not null,
  jid text not null,
  phone text,
  display_name text,
  push_name text,
  first_seen_at integer not null,
  updated_at integer not null,
  raw_json text,
  primary key (account_id, jid),
  foreign key (account_id) references accounts(id)
);
```

### `messages`

```sql
create table messages (
  account_id text not null,
  chat_jid text not null,
  message_id text not null,
  sender_jid text,
  from_me integer not null default 0,
  timestamp integer,
  received_at integer not null,
  message_type text,
  text text,
  normalized_text text,
  has_media integer not null default 0,
  quoted_message_id text,
  quoted_sender_jid text,
  edited_message_id text,
  deleted_at integer,
  raw_json text,
  primary key (account_id, chat_jid, message_id),
  foreign key (account_id, chat_jid) references chats(account_id, jid)
);
```

### `attachments`

```sql
create table attachments (
  account_id text not null,
  chat_jid text not null,
  message_id text not null,
  attachment_index integer not null default 0,
  media_type text,
  mime_type text,
  file_name text,
  file_path text,
  sha256 text,
  size_bytes integer,
  downloaded_at integer,
  raw_json text,
  primary key (account_id, chat_jid, message_id, attachment_index),
  foreign key (account_id, chat_jid, message_id)
    references messages(account_id, chat_jid, message_id)
);
```

### `events`

Optional append-only raw event log for debugging and replay.

```sql
create table events (
  id integer primary key autoincrement,
  account_id text not null,
  event_type text not null,
  event_ts integer,
  ingested_at integer not null,
  raw_json text not null,
  foreign key (account_id) references accounts(id)
);
```

### `consumer_offsets`

For downstream consumers that want `--since-last` behavior.

```sql
create table consumer_offsets (
  consumer_name text primary key,
  last_seen_timestamp integer,
  last_seen_event_id integer,
  updated_at integer not null
);
```

---

## Message normalization

The bridge should normalize common WhatsApp message shapes into a single `messages.text` field where possible:

- plain conversation text
- extended text messages
- image/video captions
- document captions
- poll names/options metadata
- reaction metadata
- deleted-message tombstones
- edited message references

The raw Baileys payload should be preserved when `store_raw_json: true` so missing normalization can be fixed later without losing data.

---

## Privacy and safety model

This project touches private messages. The safety defaults matter more than convenience.

### Defaults

- Do not send messages.
- Do not mark messages read.
- Do not mark account online on connect.
- Do not sync full history by default.
- Do not download media by default.
- Do not log message text by default.
- Do not expose all chats to downstream exports by default.

### Recommended first-run flow

1. Link account.
2. Discover chats.
3. List chats locally.
4. Explicitly allow the chats that may be exported/consumed.
5. Run sync continuously.
6. Export only allowed chats.

### Threat model notes

`whatsapp-conduit` is not a security product, but it should avoid obvious footguns:

- The Baileys auth directory is equivalent to a linked WhatsApp session. Treat it as sensitive.
- The SQLite DB may contain private messages. Treat it as sensitive.
- Backups of the DB are also sensitive.
- Logs should not contain message text unless explicitly enabled.
- If media storage is enabled, media files are sensitive too.

Possible future hardening:

- SQLCipher or filesystem-level encryption
- encrypted auth-state storage
- OS keychain integration
- automatic secret scanning in logs
- per-chat retention policies
- message-text redaction in exports

---

## Operational modes

### Foreground mode

Useful during setup and debugging:

```bash
whatsapp-conduit run --foreground --log-level debug
```

### Service mode

For real use, run continuously under systemd:

```ini
[Unit]
Description=whatsapp-conduit WhatsApp SQLite sync bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/whatsapp-conduit run --config /srv/agents-state/nicolai/whatsapp-conduit/config.yaml
Restart=always
RestartSec=10
WorkingDirectory=/srv/agents-state/nicolai/whatsapp-conduit
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

### Export mode

For downstream consumers:

```bash
whatsapp-conduit export --since-last hermes-openloops --format jsonl
```

This should:

1. read the last offset for `hermes-openloops`
2. emit new messages
3. advance the offset only after a successful export, or via explicit `--commit`

A safer two-phase model:

```bash
whatsapp-conduit export --since-last hermes-openloops --format jsonl > /tmp/messages.jsonl
whatsapp-conduit offsets commit hermes-openloops --through <event-id>
```

---

## Downstream integration examples

### Hermes cron consumer

Hermes should consume `whatsapp-conduit` as a data source, not as a messaging gateway.

Example pattern:

```bash
whatsapp-conduit export --since-last hermes-whatsapp --format jsonl --allowed-only
```

Hermes can then summarize, classify, or detect open loops outside this project.

### Simple backup

```bash
sqlite3 /srv/agents-state/nicolai/whatsapp-conduit/whatsapp-conduit.db '.backup /backup/whatsapp-conduit-$(date +%F).db'
```

### Ad hoc inspection

```bash
whatsapp-conduit chats list --allowed-only
whatsapp-conduit messages list --chat 491234567890@s.whatsapp.net --limit 20
```

---

## Implementation readiness

This README is enough to explain the product, the trust boundary, and the broad architecture. It is **not yet enough as a precise implementation spec** for an autonomous coding agent to build the whole project without making several important choices.

Before implementation, add or decide the following contracts:

### Stack decisions

- Runtime: Node.js + TypeScript.
- Package manager: `pnpm` unless project policy says otherwise.
- CLI framework: choose one, e.g. `commander`, `cac`, or `clipanion`.
- SQLite library: choose one, e.g. `better-sqlite3` for simple sync writes or `sqlite`/`sqlite3` for async style.
- Config parser: YAML via `yaml` or `js-yaml`.
- Logging: `pino`, with message text disabled in logs by default.
- Test runner: `vitest`.

### MVP command contract

Define exact behavior and output for the first commands:

```bash
whatsapp-conduit init
whatsapp-conduit link
whatsapp-conduit run
whatsapp-conduit chats list --json
whatsapp-conduit messages list --chat <jid> --limit 50 --json
whatsapp-conduit export --since-last <consumer> --format jsonl --allowed-only
whatsapp-conduit db migrate
whatsapp-conduit db check
```

Each command should specify:

- exit codes
- human output
- JSON output shape where applicable
- whether it mutates config/db state
- which files it reads/writes

### Baileys event contract

Implementation needs an explicit mapping from Baileys events to tables. At minimum:

- `connection.update` → status/logging only
- `creds.update` → save auth state
- `messages.upsert` → upsert chats, participants, messages
- `messages.update` → edits/deletes/status changes where possible
- `chats.upsert` / `chats.update` → chat metadata
- `contacts.upsert` / `contacts.update` → participant metadata if available
- group metadata events → optional, off by default unless groups enabled

### Message normalization contract

Specify the first supported message types and how they map to `messages.text`, `message_type`, and attachment metadata:

- conversation text
- extended text
- image/video caption, metadata only by default
- document metadata only by default
- audio/voice metadata only by default
- reactions
- edited messages
- deleted messages
- unsupported messages as `message_type='unknown'` with `raw_json`

### Safety invariants

These should be tested, not just documented:

- MVP code never calls `sock.sendMessage()` from ingestion paths.
- MVP code never calls `sock.readMessages()` unless a future explicit `mark_read` feature is enabled.
- `markOnlineOnConnect` defaults to `false`.
- `syncFullHistory` defaults to `false`.
- logs do not contain message text unless `logging.log_message_text: true`.
- exports include only allowed chats when `--allowed-only` is used.

### Acceptance criteria for MVP

The first useful version is done when:

1. `whatsapp-conduit init` creates config, data dir, migration state, and an empty SQLite DB.
2. `whatsapp-conduit link` pairs a WhatsApp account and persists auth state.
3. `whatsapp-conduit run` receives live messages and stores them idempotently.
4. `whatsapp-conduit chats list --json` shows discovered chats without leaking message text.
5. `whatsapp-conduit messages list --chat <jid> --json` shows stored messages for a selected chat.
6. `whatsapp-conduit export --since-last test --format jsonl` emits deterministic JSONL and advances or stages an offset.
7. Tests cover normalization, duplicate handling, migrations, and safety invariants.

---

## Development plan

### Milestone 0 — repository scaffold

- [x] Choose final name
- [ ] Create GitHub repo
- [ ] Add license
- [ ] Add `package.json`
- [ ] Add TypeScript config
- [ ] Add lint/format/test setup
- [x] Add initial README

### Milestone 1 — Baileys connection

- [ ] Install Baileys
- [ ] Implement `whatsapp-conduit link`
- [ ] Persist auth state using `useMultiFileAuthState` for MVP
- [ ] Implement reconnect loop
- [ ] Log connection state without leaking messages
- [ ] Confirm no browser/Puppeteer dependency

### Milestone 2 — SQLite foundation

- [ ] Add SQLite dependency
- [ ] Create DB schema and migrations
- [ ] Implement idempotent upserts
- [ ] Add `whatsapp-conduit db migrate`
- [ ] Add `whatsapp-conduit db check`

### Milestone 3 — message ingestion

- [ ] Listen to `messages.upsert`
- [ ] Normalize text messages
- [ ] Persist raw JSON
- [ ] Persist chat and participant stubs
- [ ] Handle `from_me`
- [ ] Handle group/private chat distinction
- [ ] Handle duplicate messages safely

### Milestone 4 — CLI inspection

- [ ] `whatsapp-conduit chats list`
- [ ] `whatsapp-conduit chats show`
- [ ] `whatsapp-conduit messages list`
- [ ] `whatsapp-conduit status`
- [ ] Basic human-readable output
- [ ] JSON output via `--json`

### Milestone 5 — filtering and privacy

- [ ] Config file support
- [ ] Allowed/blocked chats
- [ ] Include/exclude groups
- [ ] Disable status/stories
- [ ] No message text in logs
- [ ] Allowed-only export

### Milestone 6 — export interface

- [ ] JSONL export
- [ ] `--since`
- [ ] `--since-last <consumer>`
- [ ] Consumer offsets
- [ ] Optional two-phase commit for offsets

### Milestone 7 — service packaging

- [ ] systemd user unit template
- [ ] `whatsapp-conduit service install`
- [ ] Structured logs
- [ ] Health check / status file
- [ ] Graceful shutdown

### Milestone 8 — hardening

- [ ] Store media optionally
- [ ] SQLite-backed Baileys auth state
- [ ] DB migrations with rollback notes
- [ ] Integration tests with mocked Baileys events
- [ ] Backup/restore docs
- [ ] Security notes

---

## Open design questions

### Should auth state live in SQLite from day one?

Baileys provides `useMultiFileAuthState`, but upstream docs warn it is demo-ish and recommend SQL/NoSQL for production. For MVP, multi-file auth is probably fine. For a serious always-on service, SQLite auth storage would be cleaner.

Possible decision:

- MVP: `auth/` directory using `useMultiFileAuthState`
- v0.2: implement SQLite auth state

### Should raw event logging be enabled by default?

Pros:

- easier debugging
- replay parser improvements
- safer against unknown message types

Cons:

- stores more private data
- larger DB
- more sensitive backups

Possible decision:

- store raw JSON for messages by default
- do not store every non-message event by default
- make full raw event log opt-in

### Should media be downloaded?

MVP should probably not download media by default. Store metadata only, maybe with an explicit command:

```bash
whatsapp-conduit media fetch <message-id>
```

### Should status/stories be ignored?

Yes by default. Personal inbox sync should not ingest WhatsApp Status unless explicitly enabled.

### How should chat names be resolved?

WhatsApp metadata can be incomplete or change over time. Store:

- JID as stable ID
- best-known display name
- push name
- raw metadata
- update timestamps

### Should exports redact phone numbers?

Default should be unredacted for local tools, but support:

```bash
whatsapp-conduit export --redact-phone-numbers
```

---

## Example event handling sketch

Illustrative only:

```ts
sock.ev.on('messages.upsert', async ({ messages, type }) => {
  if (type !== 'notify' && type !== 'append') return

  for (const msg of messages) {
    if (!msg.message) continue
    if (isStatusMessage(msg)) continue

    const normalized = normalizeMessage(msg)

    if (!shouldStoreChat(normalized.chatJid, config)) {
      await db.recordIgnoredEvent(normalized, 'chat_filter')
      continue
    }

    await db.transaction(async tx => {
      await upsertChat(tx, normalized.chat)
      await upsertParticipant(tx, normalized.sender)
      await upsertMessage(tx, normalized.message)
    })
  }
})
```

Important: this example intentionally does **not** send replies and does **not** mark messages read.

---

## Repository structure sketch

```text
whatsapp-conduit/
  README.md
  LICENSE
  package.json
  tsconfig.json
  src/
    cli.ts
    config.ts
    daemon.ts
    baileys/
      connect.ts
      normalize.ts
      auth.ts
    db/
      index.ts
      migrations.ts
      schema.sql
      queries.ts
    commands/
      init.ts
      link.ts
      run.ts
      chats.ts
      messages.ts
      export.ts
      db.ts
    privacy/
      filters.ts
      redact.ts
    util/
      time.ts
      logging.ts
  migrations/
    0001_initial.sql
  systemd/
    whatsapp-conduit.service
  docs/
    security.md
    operations.md
    schema.md
```

---

## Expected install flow

Eventually:

```bash
git clone git@github.com:NicolaiSchmid/whatsapp-conduit.git
cd whatsapp-conduit
pnpm install
pnpm build
pnpm link --global

whatsapp-conduit init --data-dir /srv/agents-state/nicolai/whatsapp-conduit
whatsapp-conduit link
whatsapp-conduit run
```

Or with `npx`/`pnpm dlx` if published:

```bash
pnpm dlx whatsapp-conduit init
pnpm dlx whatsapp-conduit link
pnpm dlx whatsapp-conduit run
```

---

## Legal / ToS / ethics

This project uses Baileys, an unofficial WhatsApp Web protocol client. It is not affiliated with, endorsed by, or supported by WhatsApp or Meta.

Use this only for accounts and messages you are authorized to access. The intended use is personal local sync of your own WhatsApp account as a linked device.

Do not use this for:

- spam
- bulk messaging
- surveillance of accounts you do not own
- stalkerware
- bypassing consent or access controls
- automated replies that impersonate someone without review

---

## License

TBD.

Recommended: MIT or Apache-2.0.

Baileys itself is MIT-licensed. If this project remains a small utility intended for reuse, MIT is probably fine.

---

## Status

Planning / README scaffold. No implementation yet.

Current working folder:

```text
/srv/agents-state/workspace/personal/whatsapp-conduit
```

Current working name:

```text
whatsapp-conduit
```
