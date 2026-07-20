import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { applyNeedsBasedFilters, parseNeedsBasedSearchFilters } from '@/lib/provider-search-filters'
import { inferServicesFromBusinessName } from '@/lib/provider-name-service-inference'

type SearchCoords = {
  lat: number
  lng: number
}

function normalizePostcode(postcode: string) {
  return postcode.toLowerCase().replace(/\s+/g, '')
}

async function getPostcodeCoords(postcode: string) {
  const res = await fetch(`https://api.postcodes.io/postcodes/${postcode}`)
  if (!res.ok) return null
  const data = await res.json()
  return data.result ? { lat: data.result.latitude, lng: data.result.longitude } : null
}

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusMiles = 3958.8
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function buildCategoryKeyword(category: string) {
  const categoryMap: Record<string, string> = {
    vet: 'veterinary clinic',
    groomer: 'pet groomer',
    walker: 'dog walker',
    kennel: 'pet boarding kennel',
    pet_shop: 'pet shop',
    mobile_service: 'mobile pet service',
    trainer: 'dog trainer',
    sitter: 'pet sitter',
    pet_care: 'pet care',
  }

  return categoryMap[category] || categoryMap.pet_care
}

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

async function getEnrichedPlaces(supabase: Awaited<ReturnType<typeof createClient>>, coords: SearchCoords, category: string) {
  const radius = 10000
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    throw new Error('Google Places API key is missing')
  }

  const searchKeyword = buildCategoryKeyword(category)
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coords.lat},${coords.lng}&radius=${radius}&keyword=${encodeURIComponent(searchKeyword)}&key=${key}`
  const res = await fetch(url)
  const data = await res.json()

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error('[providers-search] Google Places request failed')
    throw new Error('Failed to fetch from Google Places')
  }

  const places = (data.results || []).map((place: any) => ({
    id: place.place_id,
    name: place.name,
    address: place.vicinity,
    category,
    distance_miles:
      place.geometry?.location
        ? Number(
            getDistanceMiles(coords.lat, coords.lng, place.geometry.location.lat, place.geometry.location.lng).toFixed(1)
          )
        : null,
    google_rating: place.rating
      ? {
          score: place.rating,
          count: place.user_ratings_total || 0,
          source: 'Google',
        }
      : null,
    photo_reference: place.photos?.[0]?.photo_reference || null,
  }))

  const placeIds = places.map((place: any) => place.id)
  if (placeIds.length === 0) {
    return places
  }

  const { data: dbData } = await supabase
    .from('pf_providers')
    .select('*')
    .in('google_place_id', placeIds)

  const dbProviders = dbData || []
  const dbProvidersByPlaceId = new Map<string, any>(dbProviders.map((provider) => [provider.google_place_id, provider]))
  const internalIds = dbProviders.map((provider) => provider.id)

  const { data: reviewRows } =
    internalIds.length > 0
      ? await supabase
          .from('pf_reviews')
          .select('provider_id, handling_rating, environment_rating')
          .in('provider_id', internalIds)
      : { data: [] as any[] }

  const reviewsByProviderId = new Map<string, any[]>()
  for (const review of reviewRows || []) {
    const existingReviews = reviewsByProviderId.get(review.provider_id) || []
    existingReviews.push(review)
    reviewsByProviderId.set(review.provider_id, existingReviews)
  }

  return places.map((place: any) => {
    const dbMatch = dbProvidersByPlaceId.get(place.id)
    const providerReviews = dbMatch ? reviewsByProviderId.get(dbMatch.id) || [] : []
    const inferredServicesFromName =
      Array.isArray(dbMatch?.services_inferred_from_name) && dbMatch.services_inferred_from_name.length > 0
        ? dbMatch.services_inferred_from_name
        : inferServicesFromBusinessName({
            name: dbMatch?.name || place.name,
            category: dbMatch?.category || category,
            confirmedServices: dbMatch?.services || [],
          })
    const native_rating =
      providerReviews.length > 0
        ? {
            score: Number(
              (
                providerReviews.reduce(
                  (acc, curr) => acc + (curr.handling_rating + curr.environment_rating) / 2,
                  0
                ) / providerReviews.length
              ).toFixed(1)
            ),
            count: providerReviews.length,
            source: 'Verified Reviews',
          }
        : null

    return {
      ...place,
      subscription_tier: dbMatch?.subscription_tier || 'free',
      is_verified: dbMatch?.is_verified || false,
      is_claimed: dbMatch?.is_claimed || false,
      animals_served: dbMatch?.animals_served || [],
      services: dbMatch?.services || [],
      services_inferred_from_name: inferredServicesFromName,
      breeds_specialised: dbMatch?.breeds_specialised || [],
      breeds_general_inferred: dbMatch?.breeds_general_inferred || [],
      native_rating,
    }
  })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const postcode = searchParams.get('postcode')
    const category = searchParams.get('category') || 'pet_care'
    const forceRefresh = searchParams.get('forceRefresh') === 'true'
    const searchFilters = parseNeedsBasedSearchFilters(searchParams)

    if (!postcode) {
      return NextResponse.json({ error: 'Postcode is required' }, { status: 400 })
    }

    const postcodeRegex = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i
    if (!postcodeRegex.test(postcode.trim())) {
      return NextResponse.json({ error: 'Please enter a full, valid UK postcode (e.g. S10 1BD)' }, { status: 400 })
    }

    const radius = 10000
    const cacheKey = `v2:${normalizePostcode(postcode)}:${category}:${radius}m`
    const supabase = await createClient()
    const supabaseAdmin = createAdminClient()

    if (forceRefresh) {
      const isAdmin = await isAdminForceRefreshAllowed(supabase)
      if (!isAdmin) {
        return NextResponse.json({ error: 'Force refresh is restricted to admin users' }, { status: 403 })
      }
    }

    let enrichedPlaces: any[] = []
    let searchOrigin: SearchCoords | null = null

    if (!forceRefresh) {
      const { data: cached, error: cacheReadError } = await supabaseAdmin
        .from('pf_search_cache')
        .select('results, search_lat, search_lng')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (cacheReadError) {
        console.error('[search-cache] failed to read pf_search_cache')
        return NextResponse.json({ error: 'Search cache read failed' }, { status: 500 })
      }

      if (cached?.results) {
        enrichedPlaces = cached.results
        searchOrigin =
          cached.search_lat !== null && cached.search_lng !== null
            ? { lat: Number(cached.search_lat), lng: Number(cached.search_lng) }
            : null
      }
    }

    if (enrichedPlaces.length === 0) {
      const coords = await getPostcodeCoords(postcode)
      if (!coords) {
        return NextResponse.json({ error: 'Invalid UK postcode' }, { status: 400 })
      }

      searchOrigin = coords

      try {
        enrichedPlaces = await getEnrichedPlaces(supabase, coords, category)

        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 7)

        const { error: cacheWriteError } = await supabaseAdmin.from('pf_search_cache').upsert(
          {
            cache_key: cacheKey,
            results: enrichedPlaces,
            search_lat: coords.lat,
            search_lng: coords.lng,
            expires_at: expiresAt.toISOString(),
          },
          { onConflict: 'cache_key' }
        )

        if (cacheWriteError) {
          console.error('[search-cache] failed to persist pf_search_cache')
          return NextResponse.json({ error: 'Search cache write failed' }, { status: 500 })
        }
      } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    const finalResults = applyNeedsBasedFilters(enrichedPlaces, searchFilters)

    if (finalResults.length > 0) {
      finalResults[0] = {
        ...finalResults[0],
        is_featured_result: true,
      }
    }

    return NextResponse.json({
      pf_providers: finalResults,
      search_origin: searchOrigin,
      cache: {
        key: cacheKey,
        ttl_days: 7,
        force_refresh_applied: forceRefresh,
      },
    })
  } catch (error) {
    console.error('[providers-search] Unexpected search route failure', error)
    return NextResponse.json(
      { error: 'Search is temporarily unavailable. Please try again shortly.' },
      { status: 500 }
    )
  }
}
