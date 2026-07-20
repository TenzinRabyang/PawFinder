import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateProviderReviewSummary } from '@/lib/review-summary'
import { validateSameOriginRequest } from '@/lib/csrf'

export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const csrfError = validateSameOriginRequest(request)
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 })
  }

  const { providerId } = await params
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('pf_profiles')
    .select('owned_provider_id')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.owned_provider_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (profile.owned_provider_id !== providerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await generateProviderReviewSummary(providerId)

    if (!result.updated) {
      return NextResponse.json({ message: 'Not enough pf_reviews for summary yet' })
    }

    return NextResponse.json({ summary: result.summary })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
