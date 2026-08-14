CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  user_joined   TIMESTAMP DEFAULT now()
);

CREATE TABLE board (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE board_member (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id  UUID NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  UNIQUE (board_id, user_id)
);

CREATE TABLE board_column (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id  UUID NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  position  INTEGER NOT NULL
);

CREATE TABLE card (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id    UUID NOT NULL REFERENCES board_column(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  assignee_id  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  position     INTEGER NOT NULL,
  created_at   TIMESTAMP DEFAULT now()
);