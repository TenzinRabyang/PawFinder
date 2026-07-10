import { NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseAdmin = createAdminClient()

  // Fetch all pf_reviews for this provider
  const { data: pf_reviews } = await supabaseAdmin
    .from('pf_reviews')
    .select('dog_breed, handling_rating, environment_rating, temperament_tags, comment')
    .eq('provider_id', providerId)

  if (!pf_reviews || pf_reviews.length < 5) {
    return NextResponse.json({ message: 'Not enough pf_reviews for summary yet' })
  }

  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return NextResponse.json({ error: 'DeepSeek API key missing' }, { status: 500 })

  const prompt = `
    You are an expert pet behaviorist summarizing pf_reviews for a pet service directory.
    I will provide you with a list of pf_reviews. Each review includes the dog breed, handling rating (1-5), environment rating (1-5), temperament tags, and a comment.
    Please write a short, 2-3 sentence summary in natural language capturing the overall sentiment, especially regarding how this provider handles specific temperaments (e.g. anxious rescues, high energy dogs).
    Keep it professional, empathetic, and objective. Do not mention individual reviewers.

    Reviews:
    ${JSON.stringify(pf_reviews)}
  `

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await res.json()
    const summary = data.choices[0].message.content

    // Save back to provider
    await supabaseAdmin
      .from('pf_providers')
      .update({
        review_summary: summary,
        review_summary_updated_at: new Date().toISOString()
      })
      .eq('id', providerId)

    return NextResponse.json({ summary })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
