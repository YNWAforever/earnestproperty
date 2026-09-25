-- Older rate-limit buckets are pruned opportunistically on active requests.
-- No recurring job is needed, so idle Neon databases can suspend.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON rate_limits (window_start);
