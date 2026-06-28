-- whatsapp-conduit initial schema.
-- All timestamps are epoch seconds. Persistence is idempotent on the
-- documented primary keys; raw Baileys payloads are preserved in raw_json.

create table accounts (
  id text primary key,
  label text,
  self_jid text,
  phone_number text,
  created_at integer not null,
  updated_at integer not null
);

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
  foreign key (account_id) references accounts (id)
);

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
  foreign key (account_id) references accounts (id)
);

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
  foreign key (account_id, chat_jid) references chats (account_id, jid)
);

create index messages_by_chat_ts
  on messages (account_id, chat_jid, timestamp);

create index messages_by_ts
  on messages (account_id, timestamp);

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
    references messages (account_id, chat_jid, message_id)
);

create table events (
  id integer primary key autoincrement,
  account_id text not null,
  event_type text not null,
  event_ts integer,
  ingested_at integer not null,
  raw_json text not null,
  foreign key (account_id) references accounts (id)
);

create index events_by_account_ts on events (account_id, event_ts);

create table consumer_offsets (
  consumer_name text primary key,
  last_seen_timestamp integer,
  last_seen_event_id integer,
  updated_at integer not null
);
