import { NextResponse } from 'next/server'

import {
  getProviderForPlaceIdRecovery,
  resolvePlaceDetailsWithAutoHeal,
} from '@/lib/provider-place-id-recovery'
import { createAdminClient } from '@/utils/supabase/admin'

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
  if (!includeAiSummary) {
    return NextResponse.json(result)
  }

  const reviews = (result.reviews || []).map((review: any) => ({
    rating: review.rating,
    text: review.text,
    relative_time_description: review.relative_time_description,
  }))
  const ai_summary = await summarizeReviewsWithDeepSeek(result.name || 'this business', reviews)

  return NextResponse.json({
    ...result,
    ai_summary,
  })
}
