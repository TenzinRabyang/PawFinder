import { NextResponse } from 'next/server'

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

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(id)}&fields=name,photos,reviews,rating,user_ratings_total&key=${key}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    const data = await res.json()

    if (data.status !== 'OK') {
      return NextResponse.json({ error: 'Failed to fetch featured enrichment' }, { status: 500 })
    }

    const result = data.result || {}
    const reviews = (result.reviews || []).slice(0, 2).map((review: any) => ({
      author_name: review.author_name,
      rating: review.rating,
      text: review.text,
      relative_time_description: review.relative_time_description,
    }))
    const aiSummary = await summarizeReviewsWithDeepSeek(result.name || 'this business', reviews)

    return NextResponse.json({
      photo_reference: result.photos?.[0]?.photo_reference || null,
      google_rating: result.rating
        ? {
            score: result.rating,
            count: result.user_ratings_total || 0,
            source: 'Google',
          }
        : null,
      ai_summary: aiSummary,
      google_reviews_preview: reviews,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch featured enrichment' }, { status: 500 })
  }
}
