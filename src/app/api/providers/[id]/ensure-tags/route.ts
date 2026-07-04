import { NextResponse } from 'next/server'
import { tagProviderWebsite, WebsiteFetchError } from '@/lib/provider-ai-tagging'
import { resolveProviderCategory, resolvePersistableProviderCategory } from '@/lib/provider-category'
import { createAdminClient } from '@/utils/supabase/admin'
import { persistProviderAiTags } from '@/lib/persist-provider-ai-tags'
import { inferAnimalsFromProviderPhotos } from '@/lib/provider-photo-inference'
import {
  inferServicesFromBusinessName,
  removeCategoryDuplicateServices,
} from '@/lib/provider-name-service-inference'
import {
  hasAnalysisAttemptsRemaining,
  getBreedAnalysisPersistence,
  getBreedAnalysisStatus,
  hasMeaningfulBreedAnalysis,
  shouldAutoRetryBreedAnalysis,
  shouldRefreshIncompleteBreedCoverage,
} from '@/lib/provider-analysis-state'
import { resolvePlaceDetailsWithAutoHeal } from '@/lib/provider-place-id-recovery'

const supabaseAdmin = createAdminClient()

function isMissingInferredServicesColumnError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST204' &&
    typeof error.message === 'string' &&
    error.message.includes('services_inferred_from_name')
  )
}

function hasSavedWebsiteAnalysis(provider: {
  ai_tagged_at?: string | null
  website?: string | null
  animals_served?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
}) {
  return Boolean(provider.ai_tagged_at) && Boolean(provider.website?.trim()) && hasMeaningfulBreedAnalysis(provider)
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
    services_inferred_from_name: [],
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
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY

  if (!id) {
    return NextResponse.json({ error: 'Missing provider id' }, { status: 400 })
  }

  if (!googleApiKey) {
    return NextResponse.json({ error: 'Missing Google Places API key' }, { status: 500 })
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
  const resolvedPlaceDetails = await resolvePlaceDetailsWithAutoHeal({
    requestedPlaceId: id,
    fields: 'place_id,name,formatted_address,formatted_phone_number,website,types,photos',
    googleApiKey,
    provider: provider ?? {
      google_place_id: id,
      name: body.name,
      address: body.address,
      phone: body.phone,
      website: body.website,
    },
    supabase: provider ? supabaseAdmin : undefined,
    source: 'provider-ensure-tags',
  })

  if (resolvedPlaceDetails.status !== 'OK') {
    return NextResponse.json({ error: 'Failed to validate provider details before tagging' }, { status: 404 })
  }

  const canonicalPlaceId = resolvedPlaceDetails.resolvedPlaceId || id
  const livePlaceResult = resolvedPlaceDetails.result || {}

  if (provider && canonicalPlaceId !== id) {
    provider = { ...provider, google_place_id: canonicalPlaceId }
  }

  if (!provider && canonicalPlaceId !== id) {
    const { data: canonicalProvider, error: canonicalProviderError } = await supabaseAdmin
      .from('pf_providers')
      .select('*')
      .eq('google_place_id', canonicalPlaceId)
      .maybeSingle()

    if (canonicalProviderError) {
      return NextResponse.json({ error: canonicalProviderError.message }, { status: 500 })
    }

    provider = canonicalProvider
  }

  const providerSeed = {
    ...body,
    name: livePlaceResult.name || body.name,
    address: livePlaceResult.formatted_address || body.address,
    website: livePlaceResult.website || body.website,
    phone: livePlaceResult.formatted_phone_number || body.phone,
    googleTypes:
      Array.isArray(body.googleTypes) && body.googleTypes.length > 0 ? body.googleTypes : livePlaceResult.types || [],
  }

  const ephemeralProvider = buildEphemeralProvider(canonicalPlaceId, providerSeed)
  const analysisSourceProvider = () => provider ?? ephemeralProvider

  if (!provider) {
    const resolvedCategory = resolvePersistableProviderCategory({
      requestedCategory: body.category,
      googleTypes: providerSeed.googleTypes,
      name: providerSeed.name,
      website: providerSeed.website,
    })
    if (resolvedCategory) {
      const providerShell = {
        google_place_id: canonicalPlaceId,
        name: providerSeed.name || 'Unknown Provider',
        address: providerSeed.address || null,
        postcode: derivePostcode(providerSeed.address),
        category: resolvedCategory,
        website: providerSeed.website || null,
        phone: providerSeed.phone || null,
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

  const providerName = providerSeed.name || provider?.name || ephemeralProvider.name
  const providerCategory = provider?.category || ephemeralProvider.category
  const websiteToAnalyze = providerSeed.website || provider?.website || ephemeralProvider.website

  if (!websiteToAnalyze) {
    const inferredServicesFromName = inferServicesFromBusinessName({
      name: providerName,
      category: providerCategory,
      confirmedServices: provider?.services || [],
    })
    const livePhotos = Array.isArray(livePlaceResult.photos) ? livePlaceResult.photos : []

    if (provider) {
      const { data: updatedWithoutWebsite, error: noWebsiteUpdateError } = await supabaseAdmin
        .from('pf_providers')
        .update({ services_inferred_from_name: inferredServicesFromName })
        .eq('id', provider.id)
        .select('*')
        .single()

      if (noWebsiteUpdateError && !isMissingInferredServicesColumnError(noWebsiteUpdateError)) {
        return NextResponse.json({ error: noWebsiteUpdateError.message }, { status: 500 })
      }

      const providerWithoutWebsite = updatedWithoutWebsite
        ? updatedWithoutWebsite
        : { ...provider, services_inferred_from_name: inferredServicesFromName }

      if (hasMeaningfulBreedAnalysis(providerWithoutWebsite)) {
        return NextResponse.json({
          provider: providerWithoutWebsite,
          source: 'database',
          analysis_status: getBreedAnalysisStatus(providerWithoutWebsite),
        })
      }

      if (livePhotos.length === 0) {
        return NextResponse.json({
          provider: providerWithoutWebsite,
          source: 'database',
          analysis_status: 'no_website',
        })
      }

      if (!hasAnalysisAttemptsRemaining(providerWithoutWebsite)) {
        return NextResponse.json({
          provider: providerWithoutWebsite,
          source: 'database',
          analysis_status: getBreedAnalysisStatus(providerWithoutWebsite),
        })
      }

      try {
        console.info('[photo-inference] running provider photo analysis', {
          providerId: providerWithoutWebsite.id,
          providerName,
          googlePlaceId: canonicalPlaceId,
          availablePhotoCount: livePhotos.length,
          photoLimit: 3,
          attemptNumber: (providerWithoutWebsite.tagging_attempt_count || 0) + 1,
        })

        const photoInference = await inferAnimalsFromProviderPhotos({
          providerName,
          photos: livePhotos,
          googleApiKey,
        })
        const analyzedAt = new Date().toISOString()
        const persistence = getBreedAnalysisPersistence(providerWithoutWebsite, {
          animals_served: providerWithoutWebsite.animals_served || [],
          services: providerWithoutWebsite.services || [],
          breeds_specialised: providerWithoutWebsite.breeds_specialised || [],
          breeds_general_inferred: photoInference.breeds_general_inferred,
        })

        const { data: photoAnalyzedProvider, error: photoUpdateError } = await supabaseAdmin
          .from('pf_providers')
          .update({
            google_place_id: canonicalPlaceId,
            name: providerName || providerWithoutWebsite.name,
            address: providerSeed.address || providerWithoutWebsite.address,
            phone: providerSeed.phone || providerWithoutWebsite.phone,
            services_inferred_from_name: inferredServicesFromName,
            breeds_general_inferred: photoInference.breeds_general_inferred,
            ai_tagged_at: analyzedAt,
            tagging_attempt_count: persistence.taggingAttemptCount,
            breed_analysis_exhausted: persistence.breedAnalysisExhausted,
            ai_tagging_skipped_low_content: false,
          })
          .eq('id', providerWithoutWebsite.id)
          .select('*')
          .single()

        if (photoUpdateError && !isMissingInferredServicesColumnError(photoUpdateError)) {
          return NextResponse.json({ error: photoUpdateError.message }, { status: 500 })
        }

        const nextProvider = photoAnalyzedProvider
          ? photoAnalyzedProvider
          : {
              ...providerWithoutWebsite,
              google_place_id: canonicalPlaceId,
              name: providerName || providerWithoutWebsite.name,
              address: providerSeed.address || providerWithoutWebsite.address,
              phone: providerSeed.phone || providerWithoutWebsite.phone,
              services_inferred_from_name: inferredServicesFromName,
              breeds_general_inferred: photoInference.breeds_general_inferred,
              ai_tagged_at: analyzedAt,
              tagging_attempt_count: persistence.taggingAttemptCount,
              breed_analysis_exhausted: persistence.breedAnalysisExhausted,
              ai_tagging_skipped_low_content: false,
            }

        console.info('[photo-inference] provider photo analysis completed', {
          providerId: providerWithoutWebsite.id,
          providerName,
          googlePlaceId: canonicalPlaceId,
          availablePhotoCount: livePhotos.length,
          analyzedPhotoCount: photoInference.analyzed_photo_count,
          inferredAnimals: photoInference.breeds_general_inferred,
          attemptNumber: persistence.taggingAttemptCount,
          exhausted: persistence.breedAnalysisExhausted,
          model: photoInference.model,
        })

        return NextResponse.json({
          provider: nextProvider,
          source: 'generated',
          analysis_status: getBreedAnalysisStatus(nextProvider),
          photo_analysis: {
            available_photo_count: photoInference.available_photo_count,
            analyzed_photo_count: photoInference.analyzed_photo_count,
            model: photoInference.model,
          },
        })
      } catch (error) {
        console.error('[photo-inference] provider photo analysis failed', {
          providerId: providerWithoutWebsite.id,
          providerName,
          googlePlaceId: canonicalPlaceId,
          error,
        })

        const analyzedAt = new Date().toISOString()
        const persistence = getBreedAnalysisPersistence(providerWithoutWebsite, {
          animals_served: providerWithoutWebsite.animals_served || [],
          services: providerWithoutWebsite.services || [],
          breeds_specialised: providerWithoutWebsite.breeds_specialised || [],
          breeds_general_inferred: [],
        })

        const { data: failedPhotoProvider, error: failedPhotoUpdateError } = await supabaseAdmin
          .from('pf_providers')
          .update({
            google_place_id: canonicalPlaceId,
            name: providerName || providerWithoutWebsite.name,
            address: providerSeed.address || providerWithoutWebsite.address,
            phone: providerSeed.phone || providerWithoutWebsite.phone,
            services_inferred_from_name: inferredServicesFromName,
            ai_tagged_at: analyzedAt,
            tagging_attempt_count: persistence.taggingAttemptCount,
            breed_analysis_exhausted: persistence.breedAnalysisExhausted,
            ai_tagging_skipped_low_content: false,
          })
          .eq('id', providerWithoutWebsite.id)
          .select('*')
          .single()

        if (failedPhotoUpdateError && !isMissingInferredServicesColumnError(failedPhotoUpdateError)) {
          return NextResponse.json({ error: failedPhotoUpdateError.message }, { status: 500 })
        }

        const nextProvider = failedPhotoProvider
          ? failedPhotoProvider
          : {
              ...providerWithoutWebsite,
              google_place_id: canonicalPlaceId,
              name: providerName || providerWithoutWebsite.name,
              address: providerSeed.address || providerWithoutWebsite.address,
              phone: providerSeed.phone || providerWithoutWebsite.phone,
              services_inferred_from_name: inferredServicesFromName,
              ai_tagged_at: analyzedAt,
              tagging_attempt_count: persistence.taggingAttemptCount,
              breed_analysis_exhausted: persistence.breedAnalysisExhausted,
              ai_tagging_skipped_low_content: false,
            }

        return NextResponse.json({
          provider: nextProvider,
          source: 'generated',
          analysis_status: getBreedAnalysisStatus(nextProvider),
          analysis_error_reason: 'photo_analysis_failed',
        })
      }
    }

    return NextResponse.json({
      provider: {
        ...ephemeralProvider,
        services_inferred_from_name: inferredServicesFromName,
      },
      source: 'database',
      analysis_status: 'no_website',
    })
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

  try {
    const { normalizedWebsite, pagesAnalysed, pagesAttempted, pagesFetched, aiTags, skippedLowContent, bookingAnalysis } =
      await tagProviderWebsite(websiteToAnalyze)
    const normalizedConfirmedServices = removeCategoryDuplicateServices({
      category: providerCategory,
      services: aiTags.services,
    })
    const inferredServicesFromName = inferServicesFromBusinessName({
      name: providerName,
      category: providerCategory,
      confirmedServices: normalizedConfirmedServices,
    })
    const resolvedGeneratedCategory =
      resolvePersistableProviderCategory({
        requestedCategory: body.category,
        googleTypes: providerSeed.googleTypes,
        name: providerName,
        website: normalizedWebsite,
        services: normalizedConfirmedServices,
      }) || provider?.category

    if (!provider && !resolvedGeneratedCategory) {
      return NextResponse.json({
        provider: {
          ...ephemeralProvider,
          website: normalizedWebsite,
          animals_served: aiTags.animals_served,
          services: normalizedConfirmedServices,
          services_inferred_from_name: inferredServicesFromName,
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
        google_place_id: canonicalPlaceId,
        name: providerName || 'Unknown Provider',
        address: providerSeed.address || null,
        postcode: derivePostcode(providerSeed.address),
        category: resolvedGeneratedCategory!,
        website: normalizedWebsite,
        phone: providerSeed.phone || null,
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
      services: normalizedConfirmedServices,
      breeds_specialised: aiTags.breeds_specialised,
      breeds_general_inferred: aiTags.breeds_general_inferred,
    })

    const { error: updateError } = await supabaseAdmin
      .from('pf_providers')
      .update({
        google_place_id: canonicalPlaceId,
        name: providerName || provider.name,
        address: providerSeed.address || provider.address,
        category: resolvedGeneratedCategory,
        phone: providerSeed.phone || provider.phone,
      })
      .eq('id', provider.id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    const { error: tagUpdateError } = await persistProviderAiTags(supabaseAdmin, provider.id, {
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
            services_inferred_from_name: inferServicesFromBusinessName({
              name: providerName,
              category: providerCategory,
              confirmedServices: [],
            }),
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
          services_inferred_from_name: inferServicesFromBusinessName({
            name: providerName,
            category: providerCategory,
            confirmedServices: provider?.services || [],
          }),
          tagging_attempt_count: persistence.taggingAttemptCount,
          breed_analysis_exhausted: persistence.breedAnalysisExhausted,
        })
        .eq('id', provider.id)
        .select('*')
        .single()

      if (blockedUpdateError && !isMissingInferredServicesColumnError(blockedUpdateError)) {
        console.error('[ensure-tags] failed to persist blocked website fetch status', {
          providerId: provider.id,
          error: blockedUpdateError,
        })
        return NextResponse.json({ error: blockedUpdateError.message }, { status: 500 })
      }

      return NextResponse.json({
        provider: blockedProvider
          ? blockedProvider
          : {
              ...provider,
              website: websiteToAnalyze,
              services_inferred_from_name: inferServicesFromBusinessName({
                name: providerName,
                category: providerCategory,
                confirmedServices: provider?.services || [],
              }),
              ai_tagging_skipped_low_content: true,
            },
        source: 'database',
        analysis_status: 'fetch_blocked',
        analysis_error_reason: 'website_fetch_blocked',
      })
    }

    console.error('[ensure-tags] failed to ensure provider tags', error)
    return NextResponse.json({ error: 'Provider website analysis failed' }, { status: 500 })
  }
}
