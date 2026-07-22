import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateProviderReviewSummary } from '@/lib/review-summary'
import { validateSameOriginRequest } from '@/lib/csrf'

type InsertedReviewRow = {
  id: string
  provider_id: string
  user_id: string | null
  dog_breed: string | null
  handling_rating: number | null
  environment_rating: number | null
  temperament_tags: string[] | null
  comment: string | null
  created_at: string
}

export async function POST(request: Request) {
  const csrfError = validateSameOriginRequest(request)
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { provider_id, dog_breed, handling_rating, environment_rating, comment, temperament_tags } = body

  if (!provider_id || !handling_rating || !environment_rating) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data: insertedReview, error } = await supabase
    .from('pf_reviews')
    .insert({
      provider_id,
      user_id: user.id,
      dog_breed,
      temperament_tags: temperament_tags || [],
      handling_rating,
      environment_rating,
      comment,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: profile } = await supabase
    .from('pf_profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle()

  // Regenerate the saved summary server-side without exposing a public
  // write path for arbitrary authenticated users.
  generateProviderReviewSummary(provider_id).catch(() => {})

  return NextResponse.json({
    success: true,
    review: {
      ...(insertedReview as InsertedReviewRow),
      pf_profiles: profile ? { full_name: profile.full_name } : null,
    },
  })
}
