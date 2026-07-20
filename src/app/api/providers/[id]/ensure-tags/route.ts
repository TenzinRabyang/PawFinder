import { NextResponse } from 'next/server'
import { tagProviderWebsite, WebsiteFetchError } from '@/lib/provider-ai-tagging'
import { resolveProviderCategory, resolvePersistableProviderCategory } from '@/lib/provider-category'
import { createAdminClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'
import { persistProviderAiTags } from '@/lib/persist-provider-ai-tags'
import { inferAnimalsFromProviderPhotos } from '@/lib/provider-photo-inference'
import {
  inferServicesFromBusinessName,
  removeCategoryDuplicateServices,
} from '@/lib/provider-name-service-inference'
import {
  hasAnalysisAttemptsRemaining,
  hasPhotoAnalysisAttemptsRemaining,
  getBreedAnalysisPersistence,
  getPhotoBreedAnalysisPersistence,
  getBreedAnalysisStatus,
  hasMeaningfulBreedAnalysis,
  shouldAutoRetryBreedAnalysis,
  shouldAttemptPhotoBreedSupplement,
  shouldRefreshIncompleteBreedCoverage,
} from '@/lib/provider-analysis-state'
import { resolvePlaceDetailsWithAutoHeal } from '@/lib/provider-place-id-recovery'

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
  live_place_details?: {
    place_id?: string
    name?: string
    formatted_address?: string
    formatted_phone_number?: string
    website?: string
    types?: string[]
    photos?: Array<Record<string, unknown>>
  } | null
}

type OwnerProfile = {
  owned_provider_id: string | null
}

function serializeProviderForClient(provider: Record<string, unknown> | null | undefined) {
  if (!provider) {
    return null
  }

  return {
    id: provider.id ?? null,
    google_place_id: provider.google_place_id ?? null,
    name: provider.name ?? null,
    address: provider.address ?? null,
    postcode: provider.postcode ?? null,
    category: provider.category ?? null,
    subscription_tier: provider.subscription_tier ?? null,
    website: provider.website ?? null,
    phone: provider.phone ?? null,
    breeds_specialised: Array.isArray(provider.breeds_specialised) ? provider.breeds_specialised : [],
    services: Array.isArray(provider.services) ? provider.services : [],
    services_inferred_from_name: Array.isArray(provider.services_inferred_from_name)
      ? provider.services_inferred_from_name
      : [],
    animals_served: Array.isArray(provider.animals_served) ? provider.animals_served : [],
    breeds_general_inferred: Array.isArray(provider.breeds_general_inferred)
      ? provider.breeds_general_inferred
      : [],
    has_online_booking:
      typeof provider.has_online_booking === 'boolean' ? provider.has_online_booking : false,
    booking_url: provider.booking_url ?? null,
    booking_checked_at: provider.booking_checked_at ?? null,
    tagging_attempt_count:
      typeof provider.tagging_attempt_count === 'number' ? provider.tagging_attempt_count : 0,
    breed_analysis_exhausted:
      typeof provider.breed_analysis_exhausted === 'boolean' ? provider.breed_analysis_exhausted : false,
    photo_tagging_attempt_count:
      typeof provider.photo_tagging_attempt_count === 'number' ? provider.photo_tagging_attempt_count : 0,
    photo_breed_analysis_exhausted:
      typeof provider.photo_breed_analysis_exhausted === 'boolean'
        ? provider.photo_breed_analysis_exhausted
        : false,
    ai_tagged_at: provider.ai_tagged_at ?? null,
    ai_tagging_skipped_low_content:
      typeof provider.ai_tagging_skipped_low_content === 'boolean'
        ? provider.ai_tagging_skipped_low_content
        : false,
    is_claimed: typeof provider.is_claimed === 'boolean' ? provider.is_claimed : false,
    is_verified: typeof provider.is_verified === 'boolean' ? provider.is_verified : false,
    review_summary: provider.review_summary ?? null,
    photo_reference: provider.photo_reference ?? null,
  }
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
    photo_tagging_attempt_count: 0,
    photo_breed_analysis_exhausted: false,
  }
}

function mergeUniqueValues(...values: Array<string[] | null | undefined>) {
  return Array.from(
    new Set(
      values.flatMap((value) => (Array.isArray(value) ? value : [])).filter((value): value is string => Boolean(value))
    )
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabaseAdmin = createAdminClient()
    const supabase = await createClient()
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
    const providedLivePlaceDetails =
      body.live_place_details && typeof body.live_place_details === 'object' ? body.live_place_details : null
    const providedCanonicalPlaceId =
      typeof providedLivePlaceDetails?.place_id === 'string' && providedLivePlaceDetails.place_id.trim()
        ? providedLivePlaceDetails.place_id.trim()
        : id

    if (!provider && providedLivePlaceDetails && providedCanonicalPlaceId !== id) {
      const { data: canonicalProvider, error: canonicalProviderError } = await supabaseAdmin
        .from('pf_providers')
        .select('*')
        .eq('google_place_id', providedCanonicalPlaceId)
        .maybeSingle()

      if (canonicalProviderError) {
        return NextResponse.json({ error: canonicalProviderError.message }, { status: 500 })
      }

      provider = canonicalProvider
    }

    let canonicalPlaceId = providedCanonicalPlaceId
    let livePlaceResult: Record<string, unknown> = providedLivePlaceDetails ? { ...providedLivePlaceDetails } : {}

    if (!providedLivePlaceDetails) {
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

      canonicalPlaceId = resolvedPlaceDetails.resolvedPlaceId || id
      livePlaceResult = resolvedPlaceDetails.result || {}

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
    } else if (provider && canonicalPlaceId !== id) {
      provider = { ...provider, google_place_id: canonicalPlaceId }
    }

    const providerSeed: EnsureTagsBody = {
      ...body,
      name: typeof livePlaceResult.name === 'string' ? livePlaceResult.name : body.name,
      address: typeof livePlaceResult.formatted_address === 'string' ? livePlaceResult.formatted_address : body.address,
      website: typeof livePlaceResult.website === 'string' ? livePlaceResult.website : body.website,
      phone:
        typeof livePlaceResult.formatted_phone_number === 'string'
          ? livePlaceResult.formatted_phone_number
          : body.phone,
      googleTypes:
        Array.isArray(body.googleTypes) && body.googleTypes.length > 0
          ? body.googleTypes
          : Array.isArray(livePlaceResult.types)
            ? livePlaceResult.types.filter((type): type is string => typeof type === 'string')
            : [],
    }

    const ephemeralProvider = buildEphemeralProvider(canonicalPlaceId, providerSeed)
    const analysisSourceProvider = () => provider ?? ephemeralProvider

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider analysis refresh requires an existing claimed provider.' },
        { status: 404 }
      )
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({
        provider: serializeProviderForClient(provider),
        source: 'database',
        analysis_status: getBreedAnalysisStatus(provider),
        access_mode: 'read_only',
      })
    }

    const { data: profile, error: profileError } = await supabase
      .from('pf_profiles')
      .select('owned_provider_id')
      .eq('id', user.id)
      .maybeSingle()

    const ownerProfile = (profile as OwnerProfile | null) || null

    if (profileError || ownerProfile?.owned_provider_id !== provider.id) {
      return NextResponse.json({
        provider: serializeProviderForClient(provider),
        source: 'database',
        analysis_status: getBreedAnalysisStatus(provider),
        access_mode: 'read_only',
      })
    }

  const providerName = providerSeed.name || provider?.name || ephemeralProvider.name
  const providerCategory = provider?.category || ephemeralProvider.category
  const websiteToAnalyze = providerSeed.website || provider?.website || ephemeralProvider.website
  const livePhotos = Array.isArray(livePlaceResult.photos) ? livePlaceResult.photos : []

  const runPhotoBreedInference = async ({
    providerRecord,
    servicesInferredFromName,
    responseSource,
  }: {
    providerRecord: typeof provider
    servicesInferredFromName?: string[]
    responseSource: 'generated' | 'database'
  }) => {
    const usesWebsiteAnalysis = Boolean(providerRecord?.website?.trim())
    const attemptsRemaining = usesWebsiteAnalysis
      ? hasPhotoAnalysisAttemptsRemaining(providerRecord || {})
      : hasAnalysisAttemptsRemaining(providerRecord || {})

    if (!providerRecord || livePhotos.length === 0 || !attemptsRemaining) {
      return {
        provider: providerRecord,
        source: responseSource,
        analysis_status: providerRecord ? getBreedAnalysisStatus(providerRecord) : 'no_website',
      }
    }

    try {
      const photoInference = await inferAnimalsFromProviderPhotos({
        providerName,
        photos: livePhotos,
        googleApiKey,
      })
      const analyzedAt = new Date().toISOString()
      const mergedBreedsSpecialised = mergeUniqueValues(
        providerRecord.breeds_specialised,
        photoInference.breeds_specialised
      )
      const mergedGeneralCoverage = mergeUniqueValues(
        providerRecord.breeds_general_inferred,
        photoInference.breeds_general_inferred
      )

      const { error: baseUpdateError } = await supabaseAdmin
        .from('pf_providers')
        .update({
          google_place_id: canonicalPlaceId,
          name: providerName || providerRecord.name,
          address: providerSeed.address || providerRecord.address,
          phone: providerSeed.phone || providerRecord.phone,
        })
        .eq('id', providerRecord.id)

      if (baseUpdateError) {
        return { error: baseUpdateError.message }
      }

      let attemptFields: Record<string, number | boolean>

      if (usesWebsiteAnalysis) {
        const photoPersistence = getPhotoBreedAnalysisPersistence(providerRecord || {}, {
          breeds_specialised: mergedBreedsSpecialised,
        })
        attemptFields = {
          photo_tagging_attempt_count: photoPersistence.photoTaggingAttemptCount,
          photo_breed_analysis_exhausted: photoPersistence.photoBreedAnalysisExhausted,
        }
      } else {
        const standardPersistence = getBreedAnalysisPersistence(providerRecord || {}, {
          animals_served: providerRecord?.animals_served || [],
          services: providerRecord?.services || [],
          breeds_specialised: mergedBreedsSpecialised,
          breeds_general_inferred: mergedGeneralCoverage,
        })
        attemptFields = {
          tagging_attempt_count: standardPersistence.taggingAttemptCount,
          breed_analysis_exhausted: standardPersistence.breedAnalysisExhausted,
        }
      }

      const { error: tagUpdateError } = await persistProviderAiTags(supabaseAdmin, providerRecord.id, {
        services_inferred_from_name: servicesInferredFromName,
        breeds_specialised: mergedBreedsSpecialised,
        breeds_general_inferred: mergedGeneralCoverage,
        ai_tagged_at: analyzedAt,
        ai_tagging_skipped_low_content: false,
        ...attemptFields,
      })

      if (tagUpdateError) {
        return { error: tagUpdateError.message }
      }

      const { data: refreshedProvider, error: refreshedProviderError } = await supabaseAdmin
        .from('pf_providers')
        .select('*')
        .eq('id', providerRecord.id)
        .single()

      if (refreshedProviderError) {
        return { error: refreshedProviderError.message }
      }

      return {
        provider: serializeProviderForClient(refreshedProvider),
        source: responseSource,
        analysis_status: getBreedAnalysisStatus(refreshedProvider),
        photo_analysis: {
          available_photo_count: photoInference.available_photo_count,
          analyzed_photo_count: photoInference.analyzed_photo_count,
          model: photoInference.model,
          breed_source: photoInference.breed_source,
        },
      }
    } catch {
      console.error('[photo-inference] provider photo analysis failed')

      const analyzedAt = new Date().toISOString()
      let attemptFields: Record<string, number | boolean>

      if (usesWebsiteAnalysis) {
        const photoPersistence = getPhotoBreedAnalysisPersistence(providerRecord || {}, {
          breeds_specialised: providerRecord?.breeds_specialised || [],
        })
        attemptFields = {
          photo_tagging_attempt_count: photoPersistence.photoTaggingAttemptCount,
          photo_breed_analysis_exhausted: photoPersistence.photoBreedAnalysisExhausted,
        }
      } else {
        const standardPersistence = getBreedAnalysisPersistence(providerRecord || {}, {
          animals_served: providerRecord?.animals_served || [],
          services: providerRecord?.services || [],
          breeds_specialised: providerRecord?.breeds_specialised || [],
          breeds_general_inferred: providerRecord?.breeds_general_inferred || [],
        })
        attemptFields = {
          tagging_attempt_count: standardPersistence.taggingAttemptCount,
          breed_analysis_exhausted: standardPersistence.breedAnalysisExhausted,
        }
      }

      const { error: tagUpdateError } = await persistProviderAiTags(supabaseAdmin, providerRecord.id, {
        services_inferred_from_name: servicesInferredFromName,
        ai_tagged_at: analyzedAt,
        ai_tagging_skipped_low_content: false,
        ...attemptFields,
      })

      if (tagUpdateError) {
        return { error: tagUpdateError.message }
      }

      const { data: refreshedProvider, error: refreshedProviderError } = await supabaseAdmin
        .from('pf_providers')
        .select('*')
        .eq('id', providerRecord.id)
        .single()

      if (refreshedProviderError) {
        return { error: refreshedProviderError.message }
      }

      return {
        provider: serializeProviderForClient(refreshedProvider),
        source: responseSource,
        analysis_status: getBreedAnalysisStatus(refreshedProvider),
        analysis_error_reason: 'photo_analysis_failed',
      }
    }
  }

  if (!websiteToAnalyze) {
    const inferredServicesFromName = inferServicesFromBusinessName({
      name: providerName,
      category: providerCategory,
      confirmedServices: provider?.services || [],
    })
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
          provider: serializeProviderForClient(providerWithoutWebsite),
          source: 'database',
          analysis_status: getBreedAnalysisStatus(providerWithoutWebsite),
        })
      }

      if (livePhotos.length === 0) {
        return NextResponse.json({
          provider: serializeProviderForClient(providerWithoutWebsite),
          source: 'database',
          analysis_status: 'no_website',
        })
      }

      if (!hasAnalysisAttemptsRemaining(providerWithoutWebsite)) {
        return NextResponse.json({
          provider: serializeProviderForClient(providerWithoutWebsite),
          source: 'database',
          analysis_status: getBreedAnalysisStatus(providerWithoutWebsite),
        })
      }

      const photoResult = await runPhotoBreedInference({
        providerRecord: providerWithoutWebsite,
        servicesInferredFromName: inferredServicesFromName,
        responseSource: 'generated',
      })

      if ('error' in photoResult) {
        return NextResponse.json({ error: photoResult.error }, { status: 500 })
      }

      return NextResponse.json(photoResult)
    }

    return NextResponse.json({
      provider: serializeProviderForClient({
        ...ephemeralProvider,
        services_inferred_from_name: inferredServicesFromName,
      }),
      source: 'database',
      analysis_status: 'no_website',
    })
  }

  if (
    provider &&
    livePhotos.length > 0 &&
    Boolean(provider.ai_tagged_at) &&
    shouldAttemptPhotoBreedSupplement(provider)
  ) {
    const photoSupplementResult = await runPhotoBreedInference({
      providerRecord: provider,
      responseSource: 'generated',
    })

    if ('error' in photoSupplementResult) {
      return NextResponse.json({ error: photoSupplementResult.error }, { status: 500 })
    }

    return NextResponse.json(photoSupplementResult)
  }

  if (
    hasSavedWebsiteAnalysis(analysisSourceProvider()) &&
    !shouldRefreshIncompleteBreedCoverage(analysisSourceProvider()) &&
    !(shouldAttemptPhotoBreedSupplement(analysisSourceProvider()) && livePhotos.length > 0)
  ) {
    return NextResponse.json({
      provider: serializeProviderForClient(analysisSourceProvider()),
      source: 'database',
      analysis_status: getBreedAnalysisStatus(analysisSourceProvider()),
    })
  }

  if (
    !shouldAutoRetryBreedAnalysis(analysisSourceProvider()) &&
    !shouldRefreshIncompleteBreedCoverage(analysisSourceProvider()) &&
    !(shouldAttemptPhotoBreedSupplement(analysisSourceProvider()) && livePhotos.length > 0)
  ) {
    return NextResponse.json({
      provider: serializeProviderForClient(analysisSourceProvider()),
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

    if (!resolvedGeneratedCategory) {
      return NextResponse.json(
        { error: 'Unable to determine a valid provider category for analysis refresh' },
        { status: 400 }
      )
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

    if (
      (!Array.isArray(updated.breeds_specialised) || updated.breeds_specialised.length === 0) &&
      livePhotos.length > 0 &&
      shouldAttemptPhotoBreedSupplement(updated)
    ) {
      const photoSupplementResult = await runPhotoBreedInference({
        providerRecord: updated,
        responseSource: 'generated',
      })

      if ('error' in photoSupplementResult) {
        return NextResponse.json({ error: photoSupplementResult.error }, { status: 500 })
      }

      return NextResponse.json({
        ...photoSupplementResult,
        pages_analysed: pagesAnalysed,
        pages_attempted: pagesAttempted,
        pages_fetched: pagesFetched,
        ai_tagging_skipped_low_content: skippedLowContent,
        booking_detection_source: bookingAnalysis.detectionSource,
      })
    }

    return NextResponse.json({
        provider: serializeProviderForClient(updated),
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
          console.error('[ensure-tags] failed to persist blocked website fetch status')
          return NextResponse.json({ error: blockedUpdateError.message }, { status: 500 })
        }

        return NextResponse.json({
          provider: serializeProviderForClient(blockedProvider
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
              }),
          source: 'database',
          analysis_status: 'fetch_blocked',
          analysis_error_reason: 'website_fetch_blocked',
        })
      }

      console.error('[ensure-tags] failed to ensure provider tags')
      return NextResponse.json({ error: 'Provider website analysis failed' }, { status: 500 })
    }
  } catch {
    console.error('[ensure-tags] unexpected failure')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
