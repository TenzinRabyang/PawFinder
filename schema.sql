-- pawfinder2_schema.sql
-- Run this in the Supabase SQL Editor

-- 1. Create custom types
CREATE TYPE pf_provider_category AS ENUM ('vet', 'groomer', 'walker', 'kennel', 'pet_shop', 'trainer', 'sitter', 'mobile_service', 'pet_care');
CREATE TYPE pf_subscription_status AS ENUM ('active', 'cancelled', 'trialing');

-- 2. Create tables
CREATE TABLE IF NOT EXISTS pf_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category pf_provider_category NOT NULL,
    address TEXT,
    postcode TEXT NOT NULL,
    phone TEXT,
    website TEXT,
    booking_url TEXT,
    has_online_booking BOOLEAN DEFAULT false,
    booking_checked_at TIMESTAMPTZ,
    is_claimed BOOLEAN DEFAULT false,
    google_place_id TEXT UNIQUE,
    animals_served TEXT[] DEFAULT '{}',
    services TEXT[] DEFAULT '{}',
    breeds_specialised TEXT[] DEFAULT '{}',
    breeds_general_inferred TEXT[] DEFAULT '{}',
    is_verified BOOLEAN DEFAULT false,
    subscription_tier TEXT DEFAULT 'free', -- 'free' | 'verified' | 'premium'
    ai_tagged_at TIMESTAMPTZ,
    ai_tagging_skipped_low_content BOOLEAN DEFAULT false,
    tagging_attempt_count INTEGER DEFAULT 0,
    breed_analysis_exhausted BOOLEAN DEFAULT false,
    review_summary TEXT,
    review_summary_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pf_provider_coords (
    provider_id UUID PRIMARY KEY REFERENCES pf_providers(id) ON DELETE CASCADE,
    lat NUMERIC,
    lng NUMERIC
);

CREATE TABLE IF NOT EXISTS pf_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES pf_providers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    dog_breed TEXT,
    temperament_tags TEXT[] DEFAULT '{}',
    handling_rating INT CHECK (handling_rating BETWEEN 1 AND 5),
    environment_rating INT CHECK (environment_rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pf_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    is_business_owner BOOLEAN DEFAULT false,
    owned_provider_id UUID REFERENCES pf_providers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pf_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID UNIQUE REFERENCES pf_providers(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    status pf_subscription_status,
    current_period_end TIMESTAMPTZ
);

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS ai_tagging_skipped_low_content BOOLEAN DEFAULT false;

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS has_online_booking BOOLEAN DEFAULT false;

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS booking_checked_at TIMESTAMPTZ;

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN DEFAULT false;

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS breeds_general_inferred TEXT[] DEFAULT '{}';

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS tagging_attempt_count INTEGER DEFAULT 0;

ALTER TABLE pf_providers
    ADD COLUMN IF NOT EXISTS breed_analysis_exhausted BOOLEAN DEFAULT false;

ALTER TYPE pf_provider_category ADD VALUE IF NOT EXISTS 'mobile_service';
ALTER TYPE pf_provider_category ADD VALUE IF NOT EXISTS 'pet_care';

-- 3. Enable RLS
ALTER TABLE pf_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_provider_coords ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_subscriptions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Providers: Public read, owners can update
CREATE POLICY "Providers are viewable by everyone" ON pf_providers
    FOR SELECT USING (true);

CREATE POLICY "Business owners can update their own provider" ON pf_providers
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM pf_profiles 
            WHERE pf_profiles.id = auth.uid() 
            AND pf_profiles.owned_provider_id = pf_providers.id
        )
    );

-- Provider Coords: Public read
CREATE POLICY "Provider coords are viewable by everyone" ON pf_provider_coords
    FOR SELECT USING (true);

-- Reviews: Public read, auth insert, owner update/delete
CREATE POLICY "Reviews are viewable by everyone" ON pf_reviews
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert reviews" ON pf_reviews
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reviews" ON pf_reviews
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reviews" ON pf_reviews
    FOR DELETE USING (auth.uid() = user_id);

-- Profiles: Public read, owner update
CREATE POLICY "Profiles are viewable by everyone" ON pf_profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can insert own profile" ON pf_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON pf_profiles
    FOR UPDATE USING (auth.uid() = id);

-- Subscriptions: Owner read
CREATE POLICY "Owners can view own subscriptions" ON pf_subscriptions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM pf_profiles 
            WHERE pf_profiles.id = auth.uid() 
            AND pf_profiles.owned_provider_id = pf_subscriptions.provider_id
        )
    );

-- 5. Functions & Triggers
-- Automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.pf_handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.pf_profiles (id, full_name, is_business_owner)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', false);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS pf_on_auth_user_created ON auth.users;
CREATE TRIGGER pf_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.pf_handle_new_user();

-- Setup Supabase Storage for provider photos
INSERT INTO storage.buckets (id, name, public) VALUES ('pf-provider-photos', 'pf-provider-photos', true) ON CONFLICT DO NOTHING;

CREATE POLICY "Provider photos are viewable by everyone"
ON storage.objects FOR SELECT
USING ( bucket_id = 'pf-provider-photos' );

CREATE POLICY "Business owners can upload photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'pf-provider-photos' AND
  EXISTS (
      SELECT 1 FROM pf_profiles 
      WHERE pf_profiles.id = auth.uid() 
      AND pf_profiles.owned_provider_id::text = (string_to_array(name, '/'))[1]
  )
);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_pf_providers_google_place_id ON pf_providers(google_place_id);
CREATE INDEX IF NOT EXISTS idx_pf_reviews_provider_id ON pf_reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_pf_provider_coords_provider_id ON pf_provider_coords(provider_id);
