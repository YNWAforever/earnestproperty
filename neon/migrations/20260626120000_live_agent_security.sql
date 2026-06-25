CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- FIX 1: server-generated secret token so a live-agent session can only be
-- read/appended/handed off by the original visitor who created it. The token
-- is opaque to the caller-supplied anonymous_id (analytics only).
ALTER TABLE live_agent_sessions
  ADD COLUMN IF NOT EXISTS access_token TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- FIX 2: fixed-window rate-limit counters keyed by bucket (e.g. ip + action).
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL
);
