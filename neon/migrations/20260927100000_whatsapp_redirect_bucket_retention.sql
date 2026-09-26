-- Bounded opportunistic retention for registered-link and fixed-shard redirect counters.
CREATE INDEX IF NOT EXISTS wa_link_rate_buckets_window_start_idx
  ON whatsapp_link_rate_buckets(window_start);
