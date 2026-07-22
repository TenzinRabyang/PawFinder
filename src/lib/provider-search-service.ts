import { createAdminClient } from '@/utils/supabase/admin'
import {
  applyNeedsBasedFilters,
  type NeedsBasedSearchFilters,
} from '@/lib/provider-search-filters'
import { inferServicesFromBusinessName } from '@/lib/provider-name-service-inference'

export type SearchCoords = {
  lat: number
  lng: number
}

type ProviderRatingSummary = {
  score: number
  count: number
  source: string
}

type GooglePlaceResult = {
  place_id?: string
  name?: string
  vicinity?: string
  geometry?: {
    location?: {
      lat?: number
      lng?: number
    }
  }
  rating?: number
  user_ratings_total?: number
  photos?: Array<{
    photo_reference?: string
  }>
}

type ProviderDbRecord = {
  id: string
  google_place_id: string
  name?: string | null
  category?: string | null
  subscription_tier?: string | null
  is_verified?: boolean | null
  is_claimed?: boolean | null
  animals_served?: string[] | null
  services?: string[] | null
  services_inferred_from_name?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
  review_summary?: string | null
}

type ProviderReviewRow = {
  provider_id: string
  handling_rating: number
  environment_rating: number
}

export type ProviderSearchRecord = {
  id: string
  google_place_id?: string
  name: string
  address: string
  category: string
  distance_miles: number | null
  google_rating: ProviderRatingSummary | null
  photo_reference: string | null
  subscription_tier: string
  is_verified: boolean
  is_claimed: boolean
  animals_served: string[]
  services: string[]
  services_inferred_from_name: string[]
  breeds_specialised: string[]
  breeds_general_inferred: string[]
  review_summary: string | null
  native_rating: ProviderRatingSummary | null
  is_featured_result?: boolean
}

type CachedSearchRecord = {
  results: unknown
  search_lat: number | null
  search_lng: number | null
}

export type ProviderSearchResponse = {
  providers: ProviderSearchRecord[]
  searchOrigin: SearchCoords | null
  cache: {
    key: string
    ttl_days: number
    force_refresh_applied: boolean
    hit: boolean
  }
}

const SEARCH_RADIUS_METERS = 10000
const SEARCH_CACHE_TTL_DAYS = 7
const COORD_CACHE_PRECISION = 3

export function normalizePostcode(postcode: string) {
  return postcode.toLowerCase().replace(/\s+/g, '')
}

export function isValidUkPostcode(postcode: string) {
  return /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i.test(postcode.trim())
}

function roundCoordinate(value: number) {
  return value.toFixed(COORD_CACHE_PRECISION)
}

export function buildPostcodeSearchCacheKey(postcode: string, category: string) {
  return `v2:${normalizePostcode(postcode)}:${category}:${SEARCH_RADIUS_METERS}m`
}

export function buildCoordinateSearchCacheKey(coords: SearchCoords, category: string) {
  return `v2:coords:${roundCoordinate(coords.lat)}:${roundCoordinate(coords.lng)}:${category}:${SEARCH_RADIUS_METERS}m`
}

async function getPostcodeCoords(postcode: string) {
  const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as {
    result?: {
      latitude?: number
      longitude?: number
    } | null
  }
  if (
    typeof data.result?.latitude !== 'number' ||
    !Number.isFinite(data.result.latitude) ||
    typeof data.result?.longitude !== 'number' ||
    !Number.isFinite(data.result.longitude)
  ) {
    return null
  }

  return { lat: data.result.latitude, lng: data.result.longitude }
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

async function readSearchCache(cacheKey: string) {
  const supabaseAdmin = createAdminClient()
  const { data, error } = await supabaseAdmin
    .from('pf_search_cache')
    .select('results, search_lat, search_lng')
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) {
    throw new Error('Search cache read failed')
  }

  return (data as CachedSearchRecord | null) || null
}

async function writeSearchCache(cacheKey: string, coords: SearchCoords, results: ProviderSearchRecord[]) {
  const supabaseAdmin = createAdminClient()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SEARCH_CACHE_TTL_DAYS)

  const { error } = await supabaseAdmin.from('pf_search_cache').upsert(
    {
      cache_key: cacheKey,
      results,
      search_lat: coords.lat,
      search_lng: coords.lng,
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: 'cache_key' }
  )

  if (error) {
    throw new Error('Search cache write failed')
  }
}

async function getEnrichedPlaces(coords: SearchCoords, category: string) {
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!googleApiKey) {
    throw new Error('Google Places API key is missing')
  }

  const supabaseAdmin = createAdminClient()
  const searchKeyword = buildCategoryKeyword(category)
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coords.lat},${coords.lng}&radius=${SEARCH_RADIUS_METERS}&keyword=${encodeURIComponent(searchKeyword)}&key=${googleApiKey}`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
  })
  const data = (await response.json()) as {
    status?: string
    results?: GooglePlaceResult[]
  }

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error('Failed to fetch from Google Places')
  }

  const places: ProviderSearchRecord[] = (data.results || [])
    .filter((place): place is GooglePlaceResult & { place_id: string } => typeof place.place_id === 'string')
    .map((place) => ({
      id: place.place_id,
      google_place_id: place.place_id,
      name: typeof place.name === 'string' && place.name.trim() ? place.name : 'Unknown business',
      address: typeof place.vicinity === 'string' ? place.vicinity : '',
      category,
      distance_miles:
        typeof place.geometry?.location?.lat === 'number' &&
        typeof place.geometry?.location?.lng === 'number'
          ? Number(
              getDistanceMiles(coords.lat, coords.lng, place.geometry.location.lat, place.geometry.location.lng).toFixed(1)
            )
          : null,
      google_rating:
        typeof place.rating === 'number'
          ? {
              score: place.rating,
              count: typeof place.user_ratings_total === 'number' ? place.user_ratings_total : 0,
              source: 'Google',
            }
          : null,
      photo_reference:
        typeof place.photos?.[0]?.photo_reference === 'string' ? place.photos[0].photo_reference : null,
      subscription_tier: 'free',
      is_verified: false,
      is_claimed: false,
      animals_served: [],
      services: [],
      services_inferred_from_name: [],
      breeds_specialised: [],
      breeds_general_inferred: [],
      review_summary: null,
      native_rating: null,
    }))

  const placeIds = places.map((place) => place.id)
  if (placeIds.length === 0) {
    return places
  }

  const { data: dbData } = await supabaseAdmin.from('pf_providers').select('*').in('google_place_id', placeIds)
  const dbProviders = (dbData || []) as ProviderDbRecord[]
  const dbProvidersByPlaceId = new Map<string, ProviderDbRecord>(
    dbProviders.map((provider) => [provider.google_place_id, provider])
  )
  const internalIds = dbProviders.map((provider) => provider.id)

  const { data: reviewRows } =
    internalIds.length > 0
      ? await supabaseAdmin
          .from('pf_reviews')
          .select('provider_id, handling_rating, environment_rating')
          .in('provider_id', internalIds)
      : { data: [] as ProviderReviewRow[] | null }

  const reviewsByProviderId = new Map<string, ProviderReviewRow[]>()
  for (const review of reviewRows || []) {
    const existingReviews = reviewsByProviderId.get(review.provider_id) || []
    existingReviews.push(review)
    reviewsByProviderId.set(review.provider_id, existingReviews)
  }

  return places.map((place) => {
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
                  (acc, current) => acc + (current.handling_rating + current.environment_rating) / 2,
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
      review_summary: dbMatch?.review_summary || null,
      native_rating,
    }
  })
}

async function getProvidersWithCache({
  cacheKey,
  coords,
  category,
  filters,
  forceRefresh = false,
}: {
  cacheKey: string
  coords: SearchCoords
  category: string
  filters: NeedsBasedSearchFilters
  forceRefresh?: boolean
}): Promise<ProviderSearchResponse> {
  let enrichedPlaces: ProviderSearchRecord[] = []
  let cacheHit = false

  if (!forceRefresh) {
    const cached = await readSearchCache(cacheKey)
    if (Array.isArray(cached?.results)) {
      enrichedPlaces = cached.results as ProviderSearchRecord[]
      cacheHit = true
    }
  }

  if (enrichedPlaces.length === 0) {
    enrichedPlaces = await getEnrichedPlaces(coords, category)
    await writeSearchCache(cacheKey, coords, enrichedPlaces)
  }

  return {
    providers: applyNeedsBasedFilters(enrichedPlaces, filters) as ProviderSearchRecord[],
    searchOrigin: coords,
    cache: {
      key: cacheKey,
      ttl_days: SEARCH_CACHE_TTL_DAYS,
      force_refresh_applied: forceRefresh,
      hit: cacheHit,
    },
  }
}

export async function searchProvidersByPostcode({
  postcode,
  category,
  filters,
  forceRefresh = false,
}: {
  postcode: string
  category: string
  filters: NeedsBasedSearchFilters
  forceRefresh?: boolean
}) {
  const cacheKey = buildPostcodeSearchCacheKey(postcode, category)

  if (!forceRefresh) {
    const cached = await readSearchCache(cacheKey)
    if (Array.isArray(cached?.results)) {
      return {
        providers: applyNeedsBasedFilters(cached.results as ProviderSearchRecord[], filters) as ProviderSearchRecord[],
        searchOrigin:
          cached.search_lat !== null && cached.search_lng !== null
            ? { lat: Number(cached.search_lat), lng: Number(cached.search_lng) }
            : null,
        cache: {
          key: cacheKey,
          ttl_days: SEARCH_CACHE_TTL_DAYS,
          force_refresh_applied: false,
          hit: true,
        },
      }
    }
  }

  const coords = await getPostcodeCoords(postcode)
  if (!coords) {
    throw new Error('Invalid UK postcode')
  }

  return getProvidersWithCache({
    cacheKey,
    coords,
    category,
    filters,
    forceRefresh,
  })
}

export async function searchProvidersByCoordinates({
  coords,
  category,
  filters,
  forceRefresh = false,
}: {
  coords: SearchCoords
  category: string
  filters: NeedsBasedSearchFilters
  forceRefresh?: boolean
}) {
  return getProvidersWithCache({
    cacheKey: buildCoordinateSearchCacheKey(coords, category),
    coords,
    category,
    filters,
    forceRefresh,
  })
}
