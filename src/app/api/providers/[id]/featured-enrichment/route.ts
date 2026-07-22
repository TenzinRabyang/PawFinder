import { NextResponse } from 'next/server'

import {
  getProviderForPlaceIdRecovery,
  resolvePlaceDetailsWithAutoHeal,
} from '@/lib/provider-place-id-recovery'
import { summarizeGoogleReviews } from '@/lib/google-review-summary'
import { createAdminClient } from '@/utils/supabase/admin'

function mapFeaturedLiveDetailsSnapshot(
  result: Record<string, unknown>,
  fallbackPlaceId: string,
  aiSummary: string | null
) {
  return {
    place_id: typeof result.place_id === 'string' ? result.place_id : fallbackPlaceId,
    name: typeof result.name === 'string' ? result.name : '',
    formatted_address: typeof result.formatted_address === 'string' ? result.formatted_address : '',
    formatted_phone_number:
      typeof result.formatted_phone_number === 'string' ? result.formatted_phone_number : '',
    website: typeof result.website === 'string' ? result.website : '',
    photos: Array.isArray(result.photos)
      ? result.photos.map((photo: Record<string, unknown>) => ({
          photo_reference:
            typeof photo?.photo_reference === 'string' ? photo.photo_reference : null,
        }))
      : [],
    reviews: Array.isArray(result.reviews)
      ? result.reviews.map((review: Record<string, unknown>) => ({
          author_name: typeof review.author_name === 'string' ? review.author_name : '',
          rating: typeof review.rating === 'number' ? review.rating : null,
          text: typeof review.text === 'string' ? review.text : '',
          relative_time_description:
            typeof review.relative_time_description === 'string' ? review.relative_time_description : '',
        }))
      : [],
    rating: typeof result.rating === 'number' ? result.rating : null,
    user_ratings_total:
      typeof result.user_ratings_total === 'number' ? result.user_ratings_total : null,
    opening_hours:
      result.opening_hours && typeof result.opening_hours === 'object'
        ? {
            open_now:
              typeof (result.opening_hours as { open_now?: unknown }).open_now === 'boolean'
                ? (result.opening_hours as { open_now?: boolean }).open_now
                : undefined,
          }
        : null,
    types: Array.isArray(result.types)
      ? result.types.filter((type: unknown): type is string => typeof type === 'string')
      : [],
    ai_summary: aiSummary,
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const key = process.env.GOOGLE_PLACES_API_KEY

  if (!id || !key) {
    return NextResponse.json({ error: 'Missing provider id or Google API key' }, { status: 400 })
  }

  try {
    const supabaseAdmin = createAdminClient()
    const { data: provider, error: providerError } = await getProviderForPlaceIdRecovery(supabaseAdmin, id)

    if (providerError) {
      return NextResponse.json({ error: providerError.message }, { status: 500 })
    }

    const resolvedDetails = await resolvePlaceDetailsWithAutoHeal({
      requestedPlaceId: id,
      fields:
        'place_id,name,formatted_address,formatted_phone_number,website,photos,reviews,rating,user_ratings_total,opening_hours,types',
      googleApiKey: key,
      provider,
      supabase: supabaseAdmin,
      source: 'provider-featured-enrichment',
    })

    if (resolvedDetails.status !== 'OK') {
      return NextResponse.json({ error: 'Failed to fetch featured enrichment' }, { status: 500 })
    }

    const result = resolvedDetails.result || {}
    const reviews = (Array.isArray(result.reviews) ? result.reviews : []).slice(0, 2).map((review) => ({
      rating:
        typeof (review as { rating?: unknown }).rating === 'number'
          ? (review as { rating: number }).rating
          : undefined,
      text:
        typeof (review as { text?: unknown }).text === 'string'
          ? (review as { text: string }).text
          : undefined,
      relative_time_description:
        typeof (review as { relative_time_description?: unknown }).relative_time_description === 'string'
          ? (review as { relative_time_description: string }).relative_time_description
          : undefined,
    }))
    const aiSummary = await summarizeGoogleReviews({
      placeId: typeof result.place_id === 'string' ? result.place_id : id,
      businessName: typeof result.name === 'string' ? result.name : 'this business',
      reviews,
      existingSummary: provider?.review_summary,
      maxReviews: 3,
      timeoutMs: 6000,
    })
    const liveDetailsSnapshot = mapFeaturedLiveDetailsSnapshot(result, id, aiSummary)

    return NextResponse.json({
      id: liveDetailsSnapshot.place_id,
      google_place_id: liveDetailsSnapshot.place_id,
      photo_reference: liveDetailsSnapshot.photos?.[0]?.photo_reference || null,
      google_rating: liveDetailsSnapshot.rating
        ? {
            score: liveDetailsSnapshot.rating,
            count: liveDetailsSnapshot.user_ratings_total || 0,
            source: 'Google',
          }
        : null,
      ai_summary: aiSummary,
      google_reviews_preview: reviews,
      live_details: liveDetailsSnapshot,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch featured enrichment' }, { status: 500 })
  }
}
