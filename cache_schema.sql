-- Run this in the Supabase SQL Editor to add the caching table

CREATE TABLE IF NOT EXISTS pf_search_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key TEXT UNIQUE NOT NULL,
    results JSONB NOT NULL,
    search_lat NUMERIC,
    search_lng NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE pf_search_cache
    ADD COLUMN IF NOT EXISTS search_lat NUMERIC;

ALTER TABLE pf_search_cache
    ADD COLUMN IF NOT EXISTS search_lng NUMERIC;

-- Indexes for faster lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_pf_search_cache_key ON pf_search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_pf_search_cache_expires ON pf_search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_search_cache_cache_key ON pf_search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires_at ON pf_search_cache(expires_at);

-- Enable RLS
ALTER TABLE pf_search_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cache viewable by everyone" ON pf_search_cache;
DROP POLICY IF EXISTS "Cache insertable by everyone" ON pf_search_cache;
DROP POLICY IF EXISTS "Cache updatable by everyone" ON pf_search_cache;
DROP POLICY IF EXISTS "Cache deletable by everyone" ON pf_search_cache;

CREATE POLICY "Service role can read search cache"
ON pf_search_cache
FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Service role can insert search cache"
ON pf_search_cache
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update search cache"
ON pf_search_cache
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can delete search cache"
ON pf_search_cache
FOR DELETE
TO service_role
USING (true);

-- Optional: Create a Postgres function to clean up expired cache rows
-- Schedule `select clean_expired_search_cache();` daily via pg_cron or Supabase Scheduled Jobs.
CREATE OR REPLACE FUNCTION clean_expired_search_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM pf_search_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;
