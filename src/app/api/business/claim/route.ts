import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { tagProviderWebsite, WebsiteFetchError } from '@/lib/provider-ai-tagging'
import { createAdminClient } from '@/utils/supabase/admin'
import { persistProviderAiTags } from '@/lib/persist-provider-ai-tags'
import { resolvePersistableProviderCategory } from '@/lib/provider-category'
import {
  inferServicesFromBusinessName,
  removeCategoryDuplicateServices,
} from '@/lib/provider-name-service-inference'
import {
  getBreedAnalysisPersistence,
  hasMeaningfulBreedAnalysis,
  shouldAutoRetryBreedAnalysis,
} from '@/lib/provider-analysis-state'
import { getWebsiteAnalysisMessage, type WebsiteAnalysisStatus } from '@/lib/website-analysis-status'

function isMissingInferredServicesColumnError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST204' &&
    typeof error.message === 'string' &&
    error.message.includes('services_inferred_from_name')
  )
}

function shouldRunWebsiteAnalysis(provider: {
  ai_tagged_at?: string | null
  animals_served?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
  tagging_attempt_count?: number | null
  breed_analysis_exhausted?: boolean | null
  booking_checked_at?: string | null
}) {
  const hasSavedBookingCheck = typeof provider.booking_checked_at !== 'undefined' ? Boolean(provider.booking_checked_at) : false

  return (!hasMeaningfulBreedAnalysis(provider) && shouldAutoRetryBreedAnalysis(provider)) || !hasSavedBookingCheck
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const supabaseAdmin = createAdminClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { google_place_id, name, address, category, googleTypes, website, phone } = body

    if (!google_place_id || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Check if business is already claimed
    const { data: existing, error: existingError } = await supabase
      .from('pf_providers')
      .select('*')
      .eq('google_place_id', google_place_id)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    let providerId = existing?.id

    // 2. Insert or update the provider
    const resolvedCategory =
      resolvePersistableProviderCategory({
        requestedCategory: category,
        googleTypes,
        name,
        website,
      }) || existing?.category

    if (!providerId && !resolvedCategory) {
      return NextResponse.json({ error: 'Unable to determine provider category for claim' }, { status: 500 })
    }

    if (!providerId) {
      const providerPayload = {
        google_place_id,
        name,
        address,
        postcode: address?.split(',').pop()?.trim() || '', // approximate
        category: resolvedCategory,
        website,
        phone,
        subscription_tier: 'free',
        is_claimed: false,
      }

      const { data: newProv, error: insertError } = await supabaseAdmin
        .from('pf_providers')
        .insert(providerPayload)
        .select('id')
        .single()

      if (insertError || !newProv?.id) {
        return NextResponse.json({ error: insertError?.message || 'Failed to create provider row' }, { status: 500 })
      }
      providerId = newProv.id
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('pf_providers')
        .update({
          name,
          address,
          category: resolvedCategory,
          website,
          phone,
        })
        .eq('id', providerId)

      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // 3. Link provider to user profile
    const { error: profileError } = await supabaseAdmin
      .from('pf_profiles')
      .update({
        is_business_owner: true,
        owned_provider_id: providerId
      })
      .eq('id', user.id)

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    const { error: claimFlagError } = await supabaseAdmin.from('pf_providers').update({ is_claimed: true }).eq('id', providerId)

    if (claimFlagError) {
      return NextResponse.json({ error: claimFlagError.message }, { status: 500 })
    }

    let taggingResult:
      | {
          status: WebsiteAnalysisStatus
          message: string
          animals_served?: string[]
          services?: string[]
          services_inferred_from_name?: string[]
          breeds_specialised?: string[]
          breeds_general_inferred?: string[]
          ai_tagged_at?: string | null
          pages_analysed?: number
          pages_attempted?: number
          pages_fetched?: number
          ai_tagging_skipped_low_content?: boolean
          tagging_attempt_count?: number
          breed_analysis_exhausted?: boolean
          has_online_booking?: boolean
          booking_url?: string | null
          booking_detection_source?: 'link' | 'ai' | 'none'
        }
      | null = null

    const shouldAnalyzeWebsite = Boolean(website) && (!existing || !existing.website || shouldRunWebsiteAnalysis(existing))

    if (!website) {
      const inferredServicesFromName = inferServicesFromBusinessName({
        name,
        category: resolvedCategory,
        confirmedServices: existing?.services || [],
      })

      const { error: inferenceUpdateError } = await supabaseAdmin
        .from('pf_providers')
        .update({ services_inferred_from_name: inferredServicesFromName })
        .eq('id', providerId)

      if (inferenceUpdateError && !isMissingInferredServicesColumnError(inferenceUpdateError)) {
        return NextResponse.json({ error: inferenceUpdateError.message }, { status: 500 })
      }

      taggingResult = {
        status: 'failed',
        message: 'Claim succeeded, but automatic website analysis could not run because no website URL is saved yet.',
        services_inferred_from_name: inferredServicesFromName,
      }
    } else if (!shouldAnalyzeWebsite) {
      taggingResult = {
        status: 'completed',
        message: 'Your claimed listing already has saved website analysis, so no new AI scan was needed.',
      }
    }

    // Run website analysis during claim only when saved website analysis is missing.
    if (shouldAnalyzeWebsite && website) {
      try {
        const { normalizedWebsite, pagesAnalysed, pagesAttempted, pagesFetched, aiTags, skippedLowContent, bookingAnalysis } =
          await tagProviderWebsite(website)
        const normalizedConfirmedServices = removeCategoryDuplicateServices({
          category: resolvedCategory,
          services: aiTags.services,
        })
        const inferredServicesFromName = inferServicesFromBusinessName({
          name,
          category: resolvedCategory,
          confirmedServices: normalizedConfirmedServices,
        })
        const aiTaggedAt = new Date().toISOString()
        const bookingCheckedAt = new Date().toISOString()
        const persistence = getBreedAnalysisPersistence(existing || {}, {
          animals_served: aiTags.animals_served,
          services: normalizedConfirmedServices,
          breeds_specialised: aiTags.breeds_specialised,
          breeds_general_inferred: aiTags.breeds_general_inferred,
        })

        const { error: taggingError } = await persistProviderAiTags(supabaseAdmin, providerId, {
          website: normalizedWebsite,
          animals_served: aiTags.animals_served,
          services: normalizedConfirmedServices,
          services_inferred_from_name: inferredServicesFromName,
          breeds_specialised: aiTags.breeds_specialised,
          breeds_general_inferred: aiTags.breeds_general_inferred,
          ai_tagged_at: aiTaggedAt,
          ai_tagging_skipped_low_content: skippedLowContent,
          tagging_attempt_count: persistence.taggingAttemptCount,
          breed_analysis_exhausted: persistence.breedAnalysisExhausted,
          is_claimed: true,
          has_online_booking: bookingAnalysis.hasOnlineBooking,
          booking_url: bookingAnalysis.bookingUrl,
          booking_checked_at: bookingCheckedAt,
        })

        if (taggingError) {
          console.error('[business-claim] failed to persist provider AI tags during claim', taggingError)
          taggingResult = {
            status: 'failed',
            message: getWebsiteAnalysisMessage('failed'),
          }
        } else {
          taggingResult = {
            status: skippedLowContent ? 'skipped_low_content' : 'completed',
            message: getWebsiteAnalysisMessage(skippedLowContent ? 'skipped_low_content' : 'completed'),
            animals_served: aiTags.animals_served,
            services: normalizedConfirmedServices,
            services_inferred_from_name: inferredServicesFromName,
            breeds_specialised: aiTags.breeds_specialised,
            breeds_general_inferred: aiTags.breeds_general_inferred,
            ai_tagged_at: aiTaggedAt,
            pages_analysed: pagesAnalysed,
            pages_attempted: pagesAttempted,
            pages_fetched: pagesFetched,
            ai_tagging_skipped_low_content: skippedLowContent,
            tagging_attempt_count: persistence.taggingAttemptCount,
            breed_analysis_exhausted: persistence.breedAnalysisExhausted,
            has_online_booking: bookingAnalysis.hasOnlineBooking,
            booking_url: bookingAnalysis.bookingUrl,
            booking_detection_source: bookingAnalysis.detectionSource,
          }
        }
      } catch (error) {
        if (error instanceof WebsiteFetchError && error.reason === 'fetch_blocked') {
          const persistence = getBreedAnalysisPersistence(existing || {}, {
            animals_served: [],
            services: [],
            breeds_specialised: [],
            breeds_general_inferred: [],
          })

          const { error: blockedUpdateError } = await supabaseAdmin
            .from('pf_providers')
            .update({
              website,
              ai_tagging_skipped_low_content: true,
              services_inferred_from_name: inferServicesFromBusinessName({
                name,
                category: resolvedCategory,
                confirmedServices: existing?.services || [],
              }),
              tagging_attempt_count: persistence.taggingAttemptCount,
              breed_analysis_exhausted: persistence.breedAnalysisExhausted,
              is_claimed: true,
            })
            .eq('id', providerId)

          if (blockedUpdateError && !isMissingInferredServicesColumnError(blockedUpdateError)) {
            console.error('[business-claim] failed to persist blocked website fetch status', blockedUpdateError)
            taggingResult = {
              status: 'failed',
              message: getWebsiteAnalysisMessage('failed'),
            }
          } else {
            taggingResult = {
              status: 'fetch_blocked',
              message: getWebsiteAnalysisMessage('fetch_blocked'),
              ai_tagged_at: null,
              ai_tagging_skipped_low_content: true,
              tagging_attempt_count: persistence.taggingAttemptCount,
              breed_analysis_exhausted: persistence.breedAnalysisExhausted,
            }
          }
        } else {
          console.error('[business-claim] website analysis failed during claim', error)
          taggingResult = {
            status: 'failed',
            message: getWebsiteAnalysisMessage('failed'),
          }
        }
      }
    }

    return NextResponse.json({ success: true, providerId, tagging: taggingResult })
  } catch (error) {
    console.error('[business-claim] unexpected failure', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
