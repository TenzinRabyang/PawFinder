import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { validateSameOriginRequest } from '@/lib/csrf'

export async function POST(request: Request) {
  const csrfError = validateSameOriginRequest(request)
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 })
  }

  const supabase = await createClient()
  await supabase.auth.signOut()
  
  // redirect to home
  const { origin } = new URL(request.url)
  return Response.redirect(origin)
}
