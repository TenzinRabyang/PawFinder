import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
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

  const { error } = await supabase
    .from('pf_reviews')
    .insert({
      provider_id,
      user_id: user.id,
      dog_breed,
      temperament_tags: temperament_tags || [],
      handling_rating,
      environment_rating,
      comment
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Trigger AI summary generation if needed (async)
  fetch(`${new URL(request.url).origin}/api/reviews/${provider_id}/ai-summary`, { method: 'POST' }).catch(() => {})

  return NextResponse.json({ success: true })
}
