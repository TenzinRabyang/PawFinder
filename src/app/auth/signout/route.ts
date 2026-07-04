import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  
  // redirect to home
  const { origin } = new URL(request.url)
  return Response.redirect(origin)
}
