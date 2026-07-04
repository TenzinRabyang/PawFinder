import { NextResponse } from 'next/server'
import { tagProviderWebsite, WebsiteFetchError } from '@/lib/provider-ai-tagging'
import { resolveProviderCategory, resolvePersistableProviderCategory } from '@/lib/provider-category'
import { createAdminClient } from '@/utils/supabase/admin'
import { persistProviderAiTags } from '@/lib/persist-provider-ai-tags'
import {
  getBreedAnalysisPersistence,
  getBreedAnalysisStatus,
  hasMeaningfulBreedAnalysis,
  shouldAutoRetryBreedAnalysis,
  shouldRefreshIncompleteBreedCoverage,
} from '@/lib/provider-analysis-state'

const supabaseAdmin = createAdminClient()

function hasSavedWebsiteAnalysis(provider: {
  ai_tagged_at?: string | null
  animals_served?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
}) {
  return Boolean(provider.ai_tagged_at) && hasMeaningfulBreedAnalysis(provider)
}

type EnsureTagsBody = {
  name?: string
  address?: string
  category?: string
  googleTypes?: string[]
  website?: string
  phone?: string
}

function derivePostcode(address?: string) {
  const trimmedAddress = address?.trim()
  if (!trimmedAddress) return 'UNKNOWN'

  const addressParts = trimmedAddress.split(',').map((part) => part.trim()).filter(Boolean)
  return addressParts[addressParts.length - 1] || 'UNKNOWN'
}

function buildEphemeralProvider(id: string, body: EnsureTagsBody) {
  return {
    id,
    google_place_id: id,
    name: body.name || 'Unknown Provider',
    address: body.address || null,
    postcode: derivePostcode(body.address),
    category: resolveProviderCategory({
      requestedCategory: body.category,
      googleTypes: body.googleTypes,
      name: body.name,
      website: body.website,
    }),
    website: body.website || null,
    phone: body.phone || null,
    is_claimed: false,
    subscription_tier: 'free',
    animals_served: [],
    services: [],
    breeds_specialised: [],
    breeds_general_inferred: [],
    ai_tagged_at: null,
    ai_tagging_skipped_low_content: false,
    tagging_attempt_count: 0,
    breed_analysis_exhausted: false,
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as EnsureTagsBody

  if (!id) {
    return NextResponse.json({ error: 'Missing provider id' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('pf_providers')
    .select('*')
    .eq('google_place_id', id)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  let provider = existing
  const ephemeralProvider = buildEphemeralProvider(id, body)
  const analysisSourceProvider = () => provider ?? ephemeralProvider

  if (!provider) {
    const resolvedCategory = resolvePersistableProviderCategory({
      requestedCategory: body.category,
      googleTypes: body.googleTypes,
      name: body.name,
      website: body.website,
    })
    if (resolvedCategory) {
      const providerShell = {
        google_place_id: id,
        name: body.name || 'Unknown Provider',
        address: body.address || null,
        postcode: derivePostcode(body.address),
        category: resolvedCategory,
        website: body.website || null,
        phone: body.phone || null,
        is_claimed: false,
        subscription_tier: 'free',
      }

      const { data: createdProvider, error: createError } = await supabaseAdmin
        .from('pf_providers')
        .upsert(providerShell, { onConflict: 'google_place_id' })
        .select('*')
        .single()

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }

      provider = createdProvider
      // Future cleanup consideration: unclaimed, exhausted rows with no reviews can be pruned periodically.
    }
  }

  if (
    hasSavedWebsiteAnalysis(analysisSourceProvider()) &&
    !shouldRefreshIncompleteBreedCoverage(analysisSourceProvider())
  ) {
    return NextResponse.json({
      provider: analysisSourceProvider(),
      source: 'database',
      analysis_status: getBreedAnalysisStatus(analysisSourceProvider()),
    })
  }

  if (
    !shouldAutoRetryBreedAnalysis(analysisSourceProvider()) &&
    !shouldRefreshIncompleteBreedCoverage(analysisSourceProvider())
  ) {
    return NextResponse.json({
      provider: analysisSourceProvider(),
      source: 'database',
      analysis_status: getBreedAnalysisStatus(analysisSourceProvider()),
    })
  }

  const websiteToAnalyze = body.website || provider?.website || ephemeralProvider.website
  if (!websiteToAnalyze) {
    return NextResponse.json({
      provider: provider || ephemeralProvider,
      source: 'database',
      analysis_status: 'no_website',
    })
  }

  try {
    const { normalizedWebsite, pagesAnalysed, pagesAttempted, pagesFetched, aiTags, skippedLowContent, bookingAnalysis } =
      await tagProviderWebsite(websiteToAnalyze)
    const resolvedGeneratedCategory =
      resolvePersistableProviderCategory({
        requestedCategory: body.category,
        googleTypes: body.googleTypes,
        name: body.name,
        website: body.website || normalizedWebsite,
        services: aiTags.services,
      }) || provider?.category

    if (!provider && !resolvedGeneratedCategory) {
      return NextResponse.json({
        provider: {
          ...ephemeralProvider,
          website: normalizedWebsite,
          animals_served: aiTags.animals_served,
          services: aiTags.services,
          breeds_specialised: aiTags.breeds_specialised,
          breeds_general_inferred: aiTags.breeds_general_inferred,
          ai_tagging_skipped_low_content: skippedLowContent,
        },
        source: 'generated',
        analysis_status: 'category_unresolved',
        pages_analysed: pagesAnalysed,
        pages_attempted: pagesAttempted,
        pages_fetched: pagesFetched,
        ai_tagging_skipped_low_content: skippedLowContent,
      })
    }

    if (!provider) {
      const providerShell = {
        google_place_id: id,
        name: body.name || 'Unknown Provider',
        address: body.address || null,
        postcode: derivePostcode(body.address),
        category: resolvedGeneratedCategory!,
        website: normalizedWebsite,
        phone: body.phone || null,
        is_claimed: false,
        subscription_tier: 'free',
      }

      const { data: createdProvider, error: createError } = await supabaseAdmin
        .from('pf_providers')
        .upsert(providerShell, { onConflict: 'google_place_id' })
        .select('*')
        .single()

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }

      provider = createdProvider
    }

    const aiTaggedAt = new Date().toISOString()
    const bookingCheckedAt = new Date().toISOString()
    const persistence = getBreedAnalysisPersistence(provider, {
      animals_served: aiTags.animals_served,
      services: aiTags.services,
      breeds_specialised: aiTags.breeds_specialised,
      breeds_general_inferred: aiTags.breeds_general_inferred,
    })

    const { error: updateError } = await supabaseAdmin
      .from('pf_providers')
      .update({
        name: body.name || provider.name,
        address: body.address || provider.address,
        category: resolvedGeneratedCategory,
        phone: body.phone || provider.phone,
      })
      .eq('id', provider.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const { error: tagUpdateError } = await persistProviderAiTags(supabaseAdmin, provider.id, {
      website: normalizedWebsite,
      animals_served: aiTags.animals_served,
      services: aiTags.services,
      breeds_specialised: aiTags.breeds_specialised,
      breeds_general_inferred: aiTags.breeds_general_inferred,
      ai_tagged_at: aiTaggedAt,
      ai_tagging_skipped_low_content: skippedLowContent,
      tagging_attempt_count: persistence.taggingAttemptCount,
      breed_analysis_exhausted: persistence.breedAnalysisExhausted,
      is_claimed: provider.is_claimed ?? false,
      has_online_booking: bookingAnalysis.hasOnlineBooking,
      booking_url: bookingAnalysis.bookingUrl,
      booking_checked_at: bookingCheckedAt,
    })

    if (tagUpdateError) {
      return NextResponse.json({ error: tagUpdateError.message }, { status: 500 })
    }

    const { data: updated, error: refreshedError } = await supabaseAdmin
      .from('pf_providers')
      .select('*')
      .eq('id', provider.id)
      .single()

    if (refreshedError) {
      return NextResponse.json({ error: refreshedError.message }, { status: 500 })
    }

    return NextResponse.json({
      provider: updated,
      source: 'generated',
      analysis_status: getBreedAnalysisStatus(updated),
      pages_analysed: pagesAnalysed,
      pages_attempted: pagesAttempted,
      pages_fetched: pagesFetched,
      ai_tagging_skipped_low_content: skippedLowContent,
      booking_detection_source: bookingAnalysis.detectionSource,
    })
  } catch (error) {
    if (error instanceof WebsiteFetchError && error.reason === 'fetch_blocked') {
      if (!provider) {
        return NextResponse.json({
          provider: {
            ...ephemeralProvider,
            website: websiteToAnalyze,
            ai_tagging_skipped_low_content: true,
          },
          source: 'database',
          analysis_status: 'fetch_blocked',
          analysis_error_reason: 'website_fetch_blocked',
        })
      }

      const persistence = getBreedAnalysisPersistence(provider, {
        animals_served: [],
        services: [],
        breeds_specialised: [],
        breeds_general_inferred: [],
      })

      const { data: blockedProvider, error: blockedUpdateError } = await supabaseAdmin
        .from('pf_providers')
        .update({
          website: websiteToAnalyze,
          ai_tagging_skipped_low_content: true,
          tagging_attempt_count: persistence.taggingAttemptCount,
          breed_analysis_exhausted: persistence.breedAnalysisExhausted,
        })
        .eq('id', provider.id)
        .select('*')
        .single()

      if (blockedUpdateError) {
        console.error('[ensure-tags] failed to persist blocked website fetch status', {
          providerId: provider.id,
          error: blockedUpdateError,
        })
        return NextResponse.json({ error: blockedUpdateError.message }, { status: 500 })
      }

      return NextResponse.json({
        provider: blockedProvider,
        source: 'database',
        analysis_status: 'fetch_blocked',
        analysis_error_reason: 'website_fetch_blocked',
      })
    }

    console.error('[ensure-tags] failed to ensure provider tags', error)
    return NextResponse.json({ error: 'Provider website analysis failed' }, { status: 500 })
  }
}
