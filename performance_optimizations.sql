ALTER TABLE pf_providers
  ADD COLUMN IF NOT EXISTS ai_tagging_skipped_low_content BOOLEAN DEFAULT false;

ALTER TYPE pf_provider_category ADD VALUE IF NOT EXISTS 'mobile_service';
ALTER TYPE pf_provider_category ADD VALUE IF NOT EXISTS 'pet_care';

ALTER TABLE pf_search_cache
  ADD COLUMN IF NOT EXISTS search_lat NUMERIC;

ALTER TABLE pf_search_cache
  ADD COLUMN IF NOT EXISTS search_lng NUMERIC;

CREATE INDEX IF NOT EXISTS idx_pf_providers_google_place_id ON pf_providers(google_place_id);
CREATE INDEX IF NOT EXISTS idx_pf_reviews_provider_id ON pf_reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_pf_provider_coords_provider_id ON pf_provider_coords(provider_id);
CREATE INDEX IF NOT EXISTS idx_pf_search_cache_key ON pf_search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_pf_search_cache_expires ON pf_search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_search_cache_cache_key ON pf_search_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires_at ON pf_search_cache(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pf_subscriptions_provider_id_unique ON pf_subscriptions(provider_id);
