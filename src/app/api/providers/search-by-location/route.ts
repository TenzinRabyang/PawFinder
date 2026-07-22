import { NextResponse } from 'next/server'
import { parseNeedsBasedSearchFilters } from '@/lib/provider-search-filters'
import { searchProvidersByCoordinates } from '@/lib/provider-search-service'
import { createClient } from '@/utils/supabase/server'

async function isAdminForceRefreshAllowed(supabase: Awaited<ReturnType<typeof createClient>>) {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (adminEmails.length === 0) {
    return false
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return Boolean(user?.email && adminEmails.includes(user.email.toLowerCase()))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const category = searchParams.get('category') || 'pet_care'
  const forceRefresh = searchParams.get('forceRefresh') === 'true'
  const searchFilters = parseNeedsBasedSearchFilters(searchParams)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Valid lat/lng are required' }, { status: 400 })
  }

  try {
    if (forceRefresh) {
      const supabase = await createClient()
      const isAdmin = await isAdminForceRefreshAllowed(supabase)
      if (!isAdmin) {
        return NextResponse.json({ error: 'Force refresh is restricted to admin users' }, { status: 403 })
      }
    }

    const { providers, searchOrigin, cache } = await searchProvidersByCoordinates({
      coords: { lat, lng },
      category,
      filters: searchFilters,
      forceRefresh,
    })
    const finalResults = [...providers]

    return NextResponse.json({
      pf_providers: finalResults,
      search_origin: searchOrigin,
      cache,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search is temporarily unavailable' },
      { status: 500 }
    )
  }
}
