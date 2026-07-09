import { NextResponse } from 'next/server'

import {
  getProviderForPlaceIdRecovery,
  resolvePlaceDetailsWithAutoHeal,
} from '@/lib/provider-place-id-recovery'
import { createAdminClient } from '@/utils/supabase/admin'

async function summarizeReviewsWithDeepSeek(
  name: string,
  reviews: Array<{ rating?: number; text?: string; relative_time_description?: string }>
) {
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
      signal: AbortSignal.timeout(6000),
    })

    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch {
    return null
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
    const reviews = (result.reviews || []).slice(0, 2).map((review: any) => ({
      author_name: review.author_name,
      rating: review.rating,
      text: review.text,
      relative_time_description: review.relative_time_description,
    }))
    const aiSummary = await summarizeReviewsWithDeepSeek(result.name || 'this business', reviews)
    const liveDetailsSnapshot = {
      place_id: result.place_id || id,
      name: result.name || provider?.name || null,
      formatted_address: result.formatted_address || provider?.address || null,
      formatted_phone_number: result.formatted_phone_number || provider?.phone || null,
      website: result.website || provider?.website || null,
      photos: result.photos || [],
      reviews: result.reviews || [],
      rating: result.rating ?? null,
      user_ratings_total: result.user_ratings_total ?? null,
      opening_hours: result.opening_hours || null,
      types: result.types || [],
      ai_summary: aiSummary,
    }

    return NextResponse.json({
      id: liveDetailsSnapshot.place_id,
      google_place_id: liveDetailsSnapshot.place_id,
      photo_reference: liveDetailsSnapshot.photos?.[0]?.photo_reference || null,
      google_rating: result.rating
        ? {
            score: result.rating,
            count: result.user_ratings_total || 0,
            source: 'Google',
          }
        : null,
      ai_summary: aiSummary,
      google_reviews_preview: reviews,
      live_details: liveDetailsSnapshot,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch featured enrichment' }, { status: 500 })
  }
}
