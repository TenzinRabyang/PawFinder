import { NextResponse } from 'next/server'
import { parseNeedsBasedSearchFilters } from '@/lib/provider-search-filters'
import { searchProvidersByCoordinates } from '@/lib/provider-search-service'

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
