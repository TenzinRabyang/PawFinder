import { NextResponse } from 'next/server'

import {
  getProviderForPlaceIdRecovery,
  resolvePlaceDetailsWithAutoHeal,
} from '@/lib/provider-place-id-recovery'
import { createAdminClient } from '@/utils/supabase/admin'

type LiveDetailsReview = {
  author_name: string
  rating: number | null
  text: string
  relative_time_description: string
}

type LiveDetailsPayload = {
  place_id: string
  name: string
  formatted_address: string
  formatted_phone_number: string
  website: string
  types: string[]
  photos: Array<{ photo_reference: string | null }>
  reviews: LiveDetailsReview[]
  rating: number | null
  user_ratings_total: number | null
  opening_hours: { open_now?: boolean } | null
}

function mapLiveDetailsPayload(result: Record<string, unknown>, fallbackPlaceId: string): LiveDetailsPayload {
  return {
    place_id: typeof result.place_id === 'string' ? result.place_id : fallbackPlaceId,
    name: typeof result.name === 'string' ? result.name : '',
    formatted_address: typeof result.formatted_address === 'string' ? result.formatted_address : '',
    formatted_phone_number:
      typeof result.formatted_phone_number === 'string' ? result.formatted_phone_number : '',
    website: typeof result.website === 'string' ? result.website : '',
    types: Array.isArray(result.types)
      ? result.types.filter((type: unknown): type is string => typeof type === 'string')
      : [],
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
  }
}

async function summarizeReviewsWithDeepSeek(name: string, reviews: Array<{ rating?: number; text?: string; relative_time_description?: string }>) {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key || reviews.length === 0) return null

  const prompt = `
    Write a short 2-3 sentence summary of customer feedback for "${name}".
    Focus on service quality, pet handling, friendliness, and trust signals.
    Use only the review content provided. Stay factual and concise.

    Reviews:
    ${JSON.stringify(reviews.slice(0, 3))}
  `

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const includeAiSummary = searchParams.get('include_ai_summary') === '1'
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key || !id) {
    return NextResponse.json({ error: 'Missing API key or place ID' }, { status: 400 })
  }

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
    source: 'provider-live-details',
  })

  if (resolvedDetails.status !== 'OK') {
    return NextResponse.json({ error: 'Failed to fetch place details' }, { status: 500 })
  }

  const result = resolvedDetails.result || {}
  const payload = mapLiveDetailsPayload(result, id)
  if (!includeAiSummary) {
    return NextResponse.json(payload)
  }

  const reviews = payload.reviews.map((review) => ({
    rating: review.rating ?? undefined,
    text: review.text || undefined,
    relative_time_description: review.relative_time_description || undefined,
  }))
  const ai_summary = await summarizeReviewsWithDeepSeek(payload.name || 'this business', reviews)

  return NextResponse.json({
    ...payload,
    ai_summary,
  })
}
