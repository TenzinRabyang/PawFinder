import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { tagProviderWebsite, WebsiteFetchError } from '@/lib/provider-ai-tagging'
import { persistProviderAiTags } from '@/lib/persist-provider-ai-tags'
import { getBreedAnalysisPersistence } from '@/lib/provider-analysis-state'
import { getWebsiteAnalysisMessage, type WebsiteAnalysisStatus } from '@/lib/website-analysis-status'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('pf_profiles')
    .select('owned_provider_id')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.owned_provider_id) {
    return NextResponse.json({ error: 'No claimed provider found for this user' }, { status: 404 })
  }

  const { data: provider, error: providerError } = await supabase
    .from('pf_providers')
    .select('id, website, tagging_attempt_count, ai_tagging_skipped_low_content, ai_tagged_at, breed_analysis_exhausted, animals_served, breeds_specialised, breeds_general_inferred')
    .eq('id', profile.owned_provider_id)
    .single()

  if (providerError || !provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
  }

  if (!provider.website) {
    return NextResponse.json({ error: 'Add a website URL before running AI analysis' }, { status: 400 })
  }

  try {
    const { normalizedWebsite, pagesAnalysed, pagesAttempted, pagesFetched, aiTags, skippedLowContent, bookingAnalysis } =
      await tagProviderWebsite(provider.website)
    const aiTaggedAt = new Date().toISOString()
    const bookingCheckedAt = new Date().toISOString()
    const persistence = getBreedAnalysisPersistence(provider, {
      animals_served: aiTags.animals_served,
      services: aiTags.services,
      breeds_specialised: aiTags.breeds_specialised,
      breeds_general_inferred: aiTags.breeds_general_inferred,
    })

    const { error: updateError } = await persistProviderAiTags(supabase, provider.id, {
      website: normalizedWebsite,
      animals_served: aiTags.animals_served,
      services: aiTags.services,
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

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      tagging: {
        status: skippedLowContent ? ('skipped_low_content' satisfies WebsiteAnalysisStatus) : ('completed' satisfies WebsiteAnalysisStatus),
        message: getWebsiteAnalysisMessage(skippedLowContent ? 'skipped_low_content' : 'completed'),
        pages_analysed: pagesAnalysed,
        pages_attempted: pagesAttempted,
        pages_fetched: pagesFetched,
        ai_tagged_at: aiTaggedAt,
        ai_tagging_skipped_low_content: skippedLowContent,
        tagging_attempt_count: persistence.taggingAttemptCount,
        breed_analysis_exhausted: persistence.breedAnalysisExhausted,
        animals_served: aiTags.animals_served,
        services: aiTags.services,
        breeds_specialised: aiTags.breeds_specialised,
        breeds_general_inferred: aiTags.breeds_general_inferred,
        has_online_booking: bookingAnalysis.hasOnlineBooking,
        booking_url: bookingAnalysis.bookingUrl,
        booking_detection_source: bookingAnalysis.detectionSource,
      },
    })
  } catch (error) {
    if (error instanceof WebsiteFetchError && error.reason === 'fetch_blocked') {
      const persistence = getBreedAnalysisPersistence(provider, {
        animals_served: [],
        services: [],
        breeds_specialised: [],
        breeds_general_inferred: [],
      })

      const { error: blockedUpdateError } = await supabase
        .from('pf_providers')
        .update({
          ai_tagging_skipped_low_content: true,
          tagging_attempt_count: persistence.taggingAttemptCount,
          breed_analysis_exhausted: persistence.breedAnalysisExhausted,
          is_claimed: true,
        })
        .eq('id', provider.id)

      if (blockedUpdateError) {
        return NextResponse.json({ error: blockedUpdateError.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        tagging: {
          status: 'fetch_blocked' satisfies WebsiteAnalysisStatus,
          message: getWebsiteAnalysisMessage('fetch_blocked'),
          ai_tagged_at: null,
          ai_tagging_skipped_low_content: true,
          tagging_attempt_count: persistence.taggingAttemptCount,
          breed_analysis_exhausted: persistence.breedAnalysisExhausted,
        },
      })
    }

    console.error('[business-reanalyze] failed to run provider AI tagging', error)
    return NextResponse.json({
      success: true,
      tagging: {
        status: 'failed' satisfies WebsiteAnalysisStatus,
        message: getWebsiteAnalysisMessage('failed'),
      },
    })
  }
}
