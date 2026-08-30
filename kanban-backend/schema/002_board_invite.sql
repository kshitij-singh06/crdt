-- Phase 4: Invite flow
-- Run this migration against the kanban database after schema.sql.

CREATE TABLE board_invite (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  token       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMP DEFAULT now(),
  accepted_at TIMESTAMP
);
