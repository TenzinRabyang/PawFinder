import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { applyNeedsBasedFilters, parseNeedsBasedSearchFilters } from '@/lib/provider-search-filters'
import { inferServicesFromBusinessName } from '@/lib/provider-name-service-inference'

type SearchCoords = {
  lat: number
  lng: number
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

async function getEnrichedPlaces(
  supabase: Awaited<ReturnType<typeof createClient>>,
  coords: SearchCoords,
  category: string
) {
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
    console.error('[providers-search-by-location] Google Places request failed')
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

  const { data: dbData } = await supabase.from('pf_providers').select('*').in('google_place_id', placeIds)

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
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  const category = searchParams.get('category') || 'pet_care'
  const searchFilters = parseNeedsBasedSearchFilters(searchParams)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Valid lat/lng are required' }, { status: 400 })
  }

  const supabase = await createClient()

  try {
    const enrichedPlaces = await getEnrichedPlaces(supabase, { lat, lng }, category)
    const finalResults = applyNeedsBasedFilters(enrichedPlaces, searchFilters)

    return NextResponse.json({ pf_providers: finalResults })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
