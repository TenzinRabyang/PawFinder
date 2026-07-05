import { SupabaseClient } from '@supabase/supabase-js'

type ProviderAiTagPayload = {
  website?: string | null
  animals_served?: string[]
  services?: string[]
  services_inferred_from_name?: string[]
  breeds_specialised?: string[]
  breeds_general_inferred?: string[]
  ai_tagged_at?: string
  ai_tagging_skipped_low_content?: boolean
  tagging_attempt_count?: number
  breed_analysis_exhausted?: boolean
  photo_tagging_attempt_count?: number
  photo_breed_analysis_exhausted?: boolean
  is_claimed?: boolean
  has_online_booking?: boolean
  booking_url?: string | null
  booking_checked_at?: string
}

function getMissingOptionalColumn(error: { code?: string; message?: string } | null | undefined) {
  if (error?.code !== 'PGRST204' || typeof error.message !== 'string') {
    return null
  }

  if (error.message.includes('services_inferred_from_name')) return 'services_inferred_from_name'
  if (error.message.includes('photo_tagging_attempt_count')) return 'photo_tagging_attempt_count'
  if (error.message.includes('photo_breed_analysis_exhausted')) return 'photo_breed_analysis_exhausted'

  return null
}

function isMissingOptionalColumnError(error: { code?: string; message?: string } | null | undefined) {
  return (
    getMissingOptionalColumn(error) !== null
  )
}

export async function persistProviderAiTags(
  supabase: SupabaseClient,
  providerId: string,
  payload: ProviderAiTagPayload
) {
  const updatePayload: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'undefined') {
      updatePayload[key] = value
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return { error: null }
  }

  let { error } = await supabase.from('pf_providers').update(updatePayload).eq('id', providerId)

  if (!isMissingOptionalColumnError(error)) {
    return { error }
  }

  while (isMissingOptionalColumnError(error)) {
    const missingColumn = getMissingOptionalColumn(error)
    if (!missingColumn) {
      break
    }

    delete updatePayload[missingColumn]
    ;({ error } = await supabase.from('pf_providers').update(updatePayload).eq('id', providerId))
  }

  return { error }
}
