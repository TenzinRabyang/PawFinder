import { SupabaseClient } from '@supabase/supabase-js'

type ProviderAiTagPayload = {
  website: string | null
  animals_served: string[]
  services: string[]
  breeds_specialised: string[]
  breeds_general_inferred: string[]
  ai_tagged_at: string
  ai_tagging_skipped_low_content: boolean
  tagging_attempt_count: number
  breed_analysis_exhausted: boolean
  is_claimed?: boolean
  has_online_booking: boolean
  booking_url: string | null
  booking_checked_at: string
}

export async function persistProviderAiTags(
  supabase: SupabaseClient,
  providerId: string,
  payload: ProviderAiTagPayload
) {
  const updatePayload: Record<string, unknown> = {
    website: payload.website,
    animals_served: payload.animals_served,
    services: payload.services,
    breeds_specialised: payload.breeds_specialised,
    breeds_general_inferred: payload.breeds_general_inferred,
    ai_tagged_at: payload.ai_tagged_at,
    ai_tagging_skipped_low_content: payload.ai_tagging_skipped_low_content,
    tagging_attempt_count: payload.tagging_attempt_count,
    breed_analysis_exhausted: payload.breed_analysis_exhausted,
    is_claimed: payload.is_claimed,
    has_online_booking: payload.has_online_booking,
    booking_url: payload.booking_url,
    booking_checked_at: payload.booking_checked_at,
  }

  if (typeof payload.is_claimed === 'undefined') {
    delete updatePayload.is_claimed
  }

  const { error } = await supabase.from('pf_providers').update(updatePayload).eq('id', providerId)
  return { error }
}
