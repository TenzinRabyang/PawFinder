import { createAdminClient } from '@/utils/supabase/admin'

type ProviderReviewRow = {
  dog_breed: string | null
  handling_rating: number | null
  environment_rating: number | null
  temperament_tags: string[] | null
  comment: string | null
}

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export async function generateProviderReviewSummary(providerId: string) {
  const supabaseAdmin = createAdminClient()

  const { data: pfReviews, error: reviewsError } = await supabaseAdmin
    .from('pf_reviews')
    .select('dog_breed, handling_rating, environment_rating, temperament_tags, comment')
    .eq('provider_id', providerId)

  if (reviewsError) {
    throw new Error(reviewsError.message)
  }

  const reviews = (pfReviews || []) as ProviderReviewRow[]

  if (reviews.length < 5) {
    return {
      updated: false,
      reason: 'not_enough_reviews' as const,
      summary: null,
    }
  }

  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) {
    throw new Error('DeepSeek API key missing')
  }

  const prompt = `
    You are an expert pet behaviorist summarizing pf_reviews for a pet service directory.
    I will provide you with a list of pf_reviews. Each review includes the dog breed, handling rating (1-5), environment rating (1-5), temperament tags, and a comment.
    Please write a short, 2-3 sentence summary in natural language capturing the overall sentiment, especially regarding how this provider handles specific temperaments (e.g. anxious rescues, high energy dogs).
    Keep it professional, empathetic, and objective. Do not mention individual reviewers.

    Reviews:
    ${JSON.stringify(reviews)}
  `

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
  })

  if (!response.ok) {
    throw new Error(`DeepSeek summary request failed with status ${response.status}`)
  }

  const data = (await response.json()) as DeepSeekResponse
  const summary = data.choices?.[0]?.message?.content?.trim()

  if (!summary) {
    throw new Error('DeepSeek summary response was empty')
  }

  const { error: updateError } = await supabaseAdmin
    .from('pf_providers')
    .update({
      review_summary: summary,
      review_summary_updated_at: new Date().toISOString(),
    })
    .eq('id', providerId)

  if (updateError) {
    throw new Error(updateError.message)
  }

  return {
    updated: true,
    reason: 'updated' as const,
    summary,
  }
}
