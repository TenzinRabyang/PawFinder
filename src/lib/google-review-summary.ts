type GoogleReviewSummaryInput = {
  placeId: string
  businessName: string
  reviews: Array<{
    rating?: number
    text?: string
    relative_time_description?: string
  }>
  existingSummary?: string | null
  maxReviews?: number
  timeoutMs?: number
}

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

type SummaryCacheEntry = {
  summary: string | null
  expiresAt: number
}

const GOOGLE_REVIEW_SUMMARY_TTL_MS = 1000 * 60 * 60 * 6
const googleReviewSummaryCache = new Map<string, SummaryCacheEntry>()

function cleanSummary(summary: string | null | undefined) {
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null
}

function buildReviewCacheKey(placeId: string, reviews: GoogleReviewSummaryInput['reviews']) {
  const normalizedReviews = reviews.map((review) => ({
    rating: typeof review.rating === 'number' ? review.rating : null,
    text: typeof review.text === 'string' ? review.text.trim() : '',
    relative_time_description:
      typeof review.relative_time_description === 'string' ? review.relative_time_description.trim() : '',
  }))

  return `${placeId}:${JSON.stringify(normalizedReviews)}`
}

export async function summarizeGoogleReviews({
  placeId,
  businessName,
  reviews,
  existingSummary,
  maxReviews = 3,
  timeoutMs = 6000,
}: GoogleReviewSummaryInput) {
  const reusableSummary = cleanSummary(existingSummary)
  if (reusableSummary) {
    return reusableSummary
  }

  const normalizedReviews = reviews
    .slice(0, maxReviews)
    .map((review) => ({
      rating: typeof review.rating === 'number' ? review.rating : undefined,
      text: typeof review.text === 'string' && review.text.trim() ? review.text.trim() : undefined,
      relative_time_description:
        typeof review.relative_time_description === 'string' && review.relative_time_description.trim()
          ? review.relative_time_description.trim()
          : undefined,
    }))
    .filter((review) => review.rating !== undefined || review.text || review.relative_time_description)

  if (normalizedReviews.length === 0) {
    return null
  }

  const cacheKey = buildReviewCacheKey(placeId, normalizedReviews)
  const cached = googleReviewSummaryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.summary
  }

  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) {
    return null
  }

  const prompt = `
    Write a short 2-3 sentence summary of customer feedback for "${businessName}".
    Focus on service quality, pet handling, friendliness, and trust signals.
    Use only the review content provided. Stay factual and concise.

    Reviews:
    ${JSON.stringify(normalizedReviews)}
  `

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as DeepSeekResponse
    const summary = cleanSummary(data.choices?.[0]?.message?.content)

    googleReviewSummaryCache.set(cacheKey, {
      summary,
      expiresAt: Date.now() + GOOGLE_REVIEW_SUMMARY_TTL_MS,
    })

    return summary
  } catch {
    return null
  }
}
