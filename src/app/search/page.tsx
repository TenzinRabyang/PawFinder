'use client'

import Image from 'next/image'
import { useState, useEffect, Suspense, useRef, useMemo, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowDownWideNarrow, CheckCircle, Filter, MapPin, Star } from 'lucide-react'
import { BREED_OPTIONS } from '@/lib/breed-taxonomy'
import { ProviderImage } from '@/components/ProviderImage'
import InlineSearchFeedbackCard from '@/components/search/InlineSearchFeedbackCard'
import { removeCategoryDuplicateServices } from '@/lib/provider-name-service-inference'
import { primeProviderSessionCache } from '@/lib/provider-session-cache'

type FeaturedLoadStatus = 'idle' | 'loading' | 'ready' | 'delayed' | 'error'
type SortOption = 'distance' | 'rating' | 'review_count'
type RatingSummary = {
  score: number
  count: number
  source?: string
}

type SearchProvider = {
  id: string
  google_place_id?: string
  category?: string
  subscription_tier?: string
  photo_reference?: string | null
  name: string
  address?: string
  postcode?: string
  distance_miles?: number
  google_rating?: RatingSummary | null
  native_rating?: RatingSummary | null
  services?: string[]
  animals_served?: string[]
  breeds_specialised?: string[]
  breeds_general_inferred?: string[]
  breed_match_type?: string
  ai_summary?: string | null
}

type FeaturedEnrichmentResponse = {
  error?: string
  google_place_id?: string
  live_details?: Record<string, unknown>
} & Partial<SearchProvider>

type LocationSuggestion = {
  description: string
  place_id: string
}

const LOCATION_REQUEST_TIMEOUT_MS = 15000
const POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i

function SearchContent() {
  const RESULTS_PAGE_SIZE = 5
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedLat = searchParams.get('lat')
  const selectedLng = searchParams.get('lng')
  const selectedLocationLabel = searchParams.get('location')
  console.log('[search-page] render', {
    postcode: searchParams.get('postcode'),
    lat: selectedLat,
    lng: selectedLng,
    location: selectedLocationLabel,
    animal: searchParams.get('animal'),
    category: searchParams.get('category'),
    service: searchParams.get('service'),
    breed: searchParams.get('breed'),
    href: typeof window !== 'undefined' ? window.location.href : 'server',
  })
  const [pf_providers, setProviders] = useState<SearchProvider[]>([])
  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [isApplyingFilters, setIsApplyingFilters] = useState(false)
  const [featuredLoadStatus, setFeaturedLoadStatus] = useState<Record<string, FeaturedLoadStatus>>({})
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE)
  const lastAutoFetchKeyRef = useRef<string | null>(null)
  const filters = useMemo(
    () => ({
      postcode: searchParams.get('postcode') || '',
      animal: searchParams.get('animal') || '',
      category: searchParams.get('category') || '',
      service: searchParams.get('service') || '',
      breed: searchParams.get('breed') || '',
    }),
    [searchParams]
  )
  const sortBy = useMemo<SortOption>(() => {
    const requestedSort = searchParams.get('sort')

    if (requestedSort === 'rating' || requestedSort === 'review_count' || requestedSort === 'distance') {
      return requestedSort
    }

    return 'distance'
  }, [searchParams])
  const filtersFormKey = useMemo(
    () =>
      JSON.stringify({
        location: selectedLocationLabel || filters.postcode,
        category: filters.category,
        breed: filters.breed,
      }),
    [filters.breed, filters.category, filters.postcode, selectedLocationLabel]
  )

  const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const getErrorName = (error: unknown) => (error instanceof Error ? error.name : '')

  const fetchFeaturedEnrichment = useCallback(async (providerId: string) => {
    setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: 'loading' }))

    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/featured-enrichment`, {
        signal: AbortSignal.timeout(15000),
      })
      const data = (await res.json()) as FeaturedEnrichmentResponse

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load featured details')
      }

      const placeId = data.google_place_id || providerId
      primeProviderSessionCache(placeId, {
        featuredEnrichment: data,
        liveDetails: data.live_details,
      })

      setProviders((prev) =>
        prev.map((provider) => (provider.id === providerId ? { ...provider, ...data } : provider))
      )
      setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: 'ready' }))
    } catch (err: unknown) {
      const nextStatus: FeaturedLoadStatus =
        getErrorName(err) === 'TimeoutError' || getErrorName(err) === 'AbortError' ? 'delayed' : 'error'
      setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: nextStatus }))
    }
  }, [])

  const fetchProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    setFeaturedLoadStatus({})
    setVisibleCount(RESULTS_PAGE_SIZE)
    const params = new URLSearchParams()
    if (filters.postcode) params.append('postcode', filters.postcode)
    if (selectedLat && selectedLng) {
      params.append('lat', selectedLat)
      params.append('lng', selectedLng)
    }
    if (selectedLocationLabel) params.append('location', selectedLocationLabel)
    if (filters.animal) params.append('animal', filters.animal)
    if (filters.category) params.append('category', filters.category)
    if (filters.service) params.append('service', filters.service)
    if (filters.breed) params.append('breed', filters.breed)
    const requestUrl =
      selectedLat && selectedLng
        ? `/api/providers/search-by-location?${params.toString()}`
        : `/api/providers/search?${params.toString()}`
    console.log('[search-page] fetchProviders start', {
      filters,
      requestUrl,
      href: window.location.href,
    })

    try {
      const res = await fetch(requestUrl)
      const data = await res.json()
      console.log('[search-page] fetchProviders response', {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        data,
      })
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch providers')
      }
      
      const providers = (data.pf_providers || []) as SearchProvider[]
      for (const provider of providers) {
        primeProviderSessionCache(provider.google_place_id || provider.id, {
          providerSnapshot: provider,
        })
      }
      setProviders(providers)

    } catch (err: unknown) {
      console.error('[search-page] fetchProviders error', {
        message: getErrorMessage(err),
        stack: err instanceof Error ? err.stack : null,
        filters,
        href: window.location.href,
      })
      setError(getErrorMessage(err))
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [RESULTS_PAGE_SIZE, filters, selectedLat, selectedLng, selectedLocationLabel])

  useEffect(() => {
    // Automatically fetch providers when filters state updates from the URL
    const autoFetchKey = JSON.stringify({
      postcode: filters.postcode,
      lat: selectedLat,
      lng: selectedLng,
      animal: filters.animal,
      category: filters.category,
      service: filters.service,
      breed: filters.breed,
    })

    console.log('[search-page] postcode effect', {
      postcode: filters.postcode,
      lat: selectedLat,
      lng: selectedLng,
      filters,
      autoFetchKey,
      lastAutoFetchKey: lastAutoFetchKeyRef.current,
      href: window.location.href,
    })
    if ((filters.postcode || (selectedLat && selectedLng)) && lastAutoFetchKeyRef.current !== autoFetchKey) {
      lastAutoFetchKeyRef.current = autoFetchKey
      void fetchProviders()
    }
  }, [fetchProviders, filters, selectedLat, selectedLng])

  const updateSearchUrl = ({
    nextFilters = filters,
    nextSortBy = sortBy,
  }: {
    nextFilters?: typeof filters
    nextSortBy?: SortOption
  }) => {
    const nextParams = new URLSearchParams(searchParams.toString())

    for (const [key, value] of Object.entries(nextFilters)) {
      if (value) {
        nextParams.set(key, value)
      } else {
        nextParams.delete(key)
      }
    }

    if (nextSortBy === 'distance') {
      nextParams.delete('sort')
    } else {
      nextParams.set('sort', nextSortBy)
    }

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  const resolveLocationDraft = useCallback(async (rawLocation: string) => {
    const trimmedLocation = rawLocation.trim()

    if (!trimmedLocation) {
      return {
        postcode: '',
        location: '',
        lat: '',
        lng: '',
      }
    }

    if (POSTCODE_REGEX.test(trimmedLocation)) {
      return {
        postcode: trimmedLocation.toUpperCase().replace(/\s+/g, ''),
        location: '',
        lat: '',
        lng: '',
      }
    }

    const autocompleteController = new AbortController()
    const autocompleteResponse = await fetch(
      `/api/location-autocomplete?input=${encodeURIComponent(trimmedLocation)}`,
      {
        cache: 'no-store',
        signal: autocompleteController.signal,
      }
    )

    if (!autocompleteResponse.ok) {
      throw new Error('Location suggestions are unavailable right now.')
    }

    const autocompletePayload = (await autocompleteResponse.json()) as {
      suggestions?: LocationSuggestion[]
    }
    const firstSuggestion = Array.isArray(autocompletePayload.suggestions)
      ? autocompletePayload.suggestions[0]
      : null

    if (!firstSuggestion?.place_id || !firstSuggestion.description) {
      throw new Error('Please enter a UK town, city, or full postcode.')
    }

    const detailsResponse = await fetch(
      `/api/location-details?placeId=${encodeURIComponent(firstSuggestion.place_id)}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(LOCATION_REQUEST_TIMEOUT_MS),
      }
    )

    if (!detailsResponse.ok) {
      throw new Error('We could not prepare that location. Please try again.')
    }

    const detailsPayload = (await detailsResponse.json()) as {
      lat?: number
      lng?: number
    }

    if (
      typeof detailsPayload.lat !== 'number' ||
      typeof detailsPayload.lng !== 'number'
    ) {
      throw new Error('We could not prepare that location. Please try again.')
    }

    return {
      postcode: '',
      location: firstSuggestion.description,
      lat: String(detailsPayload.lat),
      lng: String(detailsPayload.lng),
    }
  }, [])

  const handleApplyFilters = useCallback(async ({
    breed,
    category,
    location,
  }: {
    breed: string
    category: string
    location: string
  }) => {
    setLocationError(null)
    setVisibleCount(RESULTS_PAGE_SIZE)
    lastAutoFetchKeyRef.current = null
    setIsApplyingFilters(true)

    try {
      const resolvedLocation = await resolveLocationDraft(location)
      const nextParams = new URLSearchParams(searchParams.toString())

      if (category) {
        nextParams.set('category', category)
      } else {
        nextParams.delete('category')
      }

      if (breed) {
        nextParams.set('breed', breed)
      } else {
        nextParams.delete('breed')
      }

      if (resolvedLocation.postcode) {
        nextParams.set('postcode', resolvedLocation.postcode)
        nextParams.delete('location')
        nextParams.delete('lat')
        nextParams.delete('lng')
      } else if (resolvedLocation.location && resolvedLocation.lat && resolvedLocation.lng) {
        nextParams.set('location', resolvedLocation.location)
        nextParams.set('lat', resolvedLocation.lat)
        nextParams.set('lng', resolvedLocation.lng)
        nextParams.delete('postcode')
      } else {
        nextParams.delete('postcode')
        nextParams.delete('location')
        nextParams.delete('lat')
        nextParams.delete('lng')
      }

      const nextQuery = nextParams.toString()
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
    } catch (applyError) {
      setLocationError(applyError instanceof Error ? applyError.message : 'Unable to update the search area.')
    } finally {
      setIsApplyingFilters(false)
    }
  }, [pathname, resolveLocationDraft, router, searchParams])

  const handleSortChange = (value: SortOption) => {
    setVisibleCount(RESULTS_PAGE_SIZE)
    updateSearchUrl({ nextSortBy: value })
  }

  const getSortMetrics = (provider: SearchProvider) => {
    const reviewScore =
      typeof provider?.native_rating?.score === 'number'
        ? provider.native_rating.score
        : typeof provider?.google_rating?.score === 'number'
          ? provider.google_rating.score
          : -1
    const reviewCount =
      typeof provider?.native_rating?.count === 'number'
        ? provider.native_rating.count
        : typeof provider?.google_rating?.count === 'number'
          ? provider.google_rating.count
          : -1
    const distance =
      typeof provider?.distance_miles === 'number' ? provider.distance_miles : Number.POSITIVE_INFINITY

    return { reviewScore, reviewCount, distance }
  }

  const sortedProviders = useMemo(() => {
    const providers = [...pf_providers]

    providers.sort((a, b) => {
      const aMetrics = getSortMetrics(a)
      const bMetrics = getSortMetrics(b)

      if (sortBy === 'rating') {
        if (bMetrics.reviewScore !== aMetrics.reviewScore) return bMetrics.reviewScore - aMetrics.reviewScore
        if (bMetrics.reviewCount !== aMetrics.reviewCount) return bMetrics.reviewCount - aMetrics.reviewCount
        return aMetrics.distance - bMetrics.distance
      }

      if (sortBy === 'review_count') {
        if (bMetrics.reviewCount !== aMetrics.reviewCount) return bMetrics.reviewCount - aMetrics.reviewCount
        if (bMetrics.reviewScore !== aMetrics.reviewScore) return bMetrics.reviewScore - aMetrics.reviewScore
        return aMetrics.distance - bMetrics.distance
      }

      if (aMetrics.distance !== bMetrics.distance) return aMetrics.distance - bMetrics.distance
      if (bMetrics.reviewScore !== aMetrics.reviewScore) return bMetrics.reviewScore - aMetrics.reviewScore
      return bMetrics.reviewCount - aMetrics.reviewCount
    })

    return providers
  }, [pf_providers, sortBy])

  const visibleProviders = useMemo(
    () => sortedProviders.slice(0, visibleCount),
    [sortedProviders, visibleCount]
  )
  const searchFeedbackQuery = filters.postcode || selectedLocationLabel || 'this area'
  const searchFeedbackSessionKey = useMemo(
    () => `pawfinder:inline-search-feedback:${searchParams.toString() || 'default'}`,
    [searchParams]
  )
  const searchFeedbackInsertIndex = useMemo(
    () => (visibleProviders.length > 0 ? Math.min(2, visibleProviders.length - 1) : -1),
    [visibleProviders.length]
  )

  const hasMoreResults = visibleCount < sortedProviders.length

  useEffect(() => {
    const featuredProvider = sortedProviders[0]
    if (!featuredProvider?.id) return

    const status = featuredLoadStatus[featuredProvider.id]
    if ((status || 'idle') !== 'idle') return

    const timeoutId = window.setTimeout(() => {
      void fetchFeaturedEnrichment(featuredProvider.id)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fetchFeaturedEnrichment, featuredLoadStatus, sortedProviders])

  const getPrimaryTags = (provider: SearchProvider) => {
    const visibleConfirmedServices = removeCategoryDuplicateServices({
      category: provider.category,
      services: provider.services,
    })
    if (visibleConfirmedServices.length) return visibleConfirmedServices.slice(0, 2)
    if (provider.animals_served?.length) return provider.animals_served.slice(0, 2)
    if (provider.breeds_specialised?.length) return provider.breeds_specialised.slice(0, 2)
    if (provider.breeds_general_inferred?.length) {
      return provider.breeds_general_inferred.slice(0, 2).map((animal: string) => `general_${animal}`)
    }
    return []
  }

  const formatGeneralCoverageLabel = (value: string) => {
    if (value === 'general_dog') return 'Generally treats dogs'
    if (value === 'general_cat') return 'Generally treats cats'
    if (value === 'general_rabbit') return 'Generally treats rabbits'
    return value
  }

  const formatCategoryLabel = (value: string | null | undefined) =>
    (value || 'Uncategorised')
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')

  const getFeaturedLabel = () => {
    if (sortBy === 'rating') return 'Top Rated'
    if (sortBy === 'review_count') return 'Most Reviewed'
    return 'Nearest Match'
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:gap-6 lg:px-8 lg:py-6">
      <header className="rounded-[1.8rem] border border-[#DDD3C6] bg-[#FFFDFC]/92 px-4 py-4 shadow-[0_18px_40px_-34px_rgba(32,38,31,0.34)] backdrop-blur sm:px-5">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 overflow-hidden rounded-full border border-[#D7CCBE] bg-[#F6F1E8] shadow-[0_12px_26px_-18px_rgba(32,38,31,0.45)]">
            <Image
              src="/pet-placeholder.svg"
              alt="PawFinder logo"
              fill
              sizes="48px"
              className="object-cover"
              priority
            />
          </div>
          <div>
            <Link
              href="/"
              className="font-display text-[1.55rem] tracking-[-0.03em] text-[#20261F] transition-colors hover:text-[#B14A2B]"
            >
              PawFinder
            </Link>
            <p className="mt-0.5 text-sm text-[#6C675E]">
              Search with breed, temperament, and local context in one place.
            </p>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="w-full flex-shrink-0">
        <div className="rounded-2xl border border-stone-100 bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-4">
          <div className="mb-3 flex items-center gap-2">
            <Filter className="h-4 w-4 text-stone-500" />
            <h2 className="text-base font-semibold text-stone-800">Filters</h2>
          </div>
          
          <form
            key={filtersFormKey}
            onSubmit={(event) => {
              event.preventDefault()
              const formData = new FormData(event.currentTarget)
              void handleApplyFilters({
                location: String(formData.get('location') || ''),
                category: String(formData.get('category') || ''),
                breed: String(formData.get('breed') || ''),
              })
            }}
            className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
          >
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Location</label>
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 focus-within:border-[#829e8d] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#829e8d]">
                <MapPin className="h-4 w-4 flex-shrink-0 text-stone-400" />
                <input
                  name="location"
                  type="text"
                  defaultValue={selectedLocationLabel || filters.postcode}
                  onChange={() => {
                    setLocationError(null)
                  }}
                  placeholder="City, town, or postcode"
                  className="w-full bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-400"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Category</label>
              <select
                name="category"
                defaultValue={filters.category}
                className="w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:border-[#829e8d] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#829e8d]"
              >
                <option value="">All Categories</option>
                <option value="vet">Veterinarian</option>
                <option value="groomer">Groomer</option>
                <option value="walker">Dog Walker</option>
                <option value="kennel">Kennel / Boarding</option>
                <option value="pet_shop">Pet Shop</option>
                <option value="mobile_service">Mobile Service</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Breed</label>
              <select
                name="breed"
                defaultValue={filters.breed}
                className="w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:border-[#829e8d] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#829e8d]"
              >
                <option value="">All Breeds</option>
                {BREED_OPTIONS.map((breed) => (
                  <option key={breed.value} value={breed.value}>
                    {breed.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 flex items-center text-xs font-medium uppercase tracking-wide text-stone-500">
                <ArrowDownWideNarrow className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
                Sort Results
              </label>
              <select
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value as SortOption)}
                className="w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:border-[#829e8d] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#829e8d]"
              >
                <option value="distance">Distance</option>
                <option value="rating">Review Star</option>
                <option value="review_count">Review Count</option>
              </select>
            </div>

            <div>
              <button
                type="submit"
                disabled={isApplyingFilters}
                className="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400 md:w-auto md:min-w-[126px]"
              >
                {isApplyingFilters ? 'Applying...' : 'Apply'}
              </button>
            </div>
            
            {locationError && (
              <p className="text-[11px] leading-relaxed text-[#B14A2B] md:col-span-5">
                {locationError}
              </p>
            )}

            <p className="text-[11px] leading-relaxed text-stone-400 md:col-span-5 md:pt-1">
              Filter results are most accurate for verified providers. Unclaimed businesses are included by default.
            </p>
          </form>
        </div>
      </aside>

      {/* Results */}
      <main className="flex-1">
        {!loading && !error && sortedProviders.length > 0 && (
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-stone-100 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-sm font-semibold text-stone-800">
                Showing {Math.min(visibleCount, sortedProviders.length)} of {sortedProviders.length} businesses
              </div>
              <p className="mt-1 text-sm text-stone-500">
                Sorted by {sortBy === 'distance' ? 'distance' : sortBy === 'rating' ? 'highest review star' : 'highest review count'}.
              </p>
            </div>
            <div className="inline-flex w-full items-center justify-center rounded-full bg-stone-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 sm:w-auto">
              {getFeaturedLabel()} shown first
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 mb-6">
            <h3 className="font-semibold mb-1">Error loading results</h3>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: RESULTS_PAGE_SIZE }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
                  <div className="h-48 w-full animate-pulse rounded-xl bg-stone-200 sm:h-32 sm:w-32 sm:flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1">
                        <div className="h-4 w-24 animate-pulse rounded-full bg-[#f6edd1]" />
                        <div className="mt-3 h-7 w-2/3 animate-pulse rounded-full bg-stone-200" />
                        <div className="mt-2 h-4 w-32 animate-pulse rounded-full bg-stone-100" />
                      </div>
                      <div className="space-y-2 sm:min-w-[8rem]">
                        <div className="h-8 w-24 animate-pulse rounded-lg bg-stone-100" />
                        <div className="h-8 w-32 animate-pulse rounded-lg bg-[#829e8d]/10" />
                      </div>
                    </div>
                    <div className="mt-5 h-4 w-3/4 animate-pulse rounded-full bg-stone-100" />
                    <div className="mt-4 flex gap-2">
                      <div className="h-7 w-24 animate-pulse rounded-full bg-stone-100" />
                      <div className="h-7 w-20 animate-pulse rounded-full bg-stone-100" />
                    </div>
                    <div className="mt-5 rounded-xl border border-stone-100 bg-stone-50/70 p-4">
                      <div className="h-3 w-36 animate-pulse rounded-full bg-stone-200" />
                      <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-stone-100" />
                      <div className="mt-2 h-3 w-5/6 animate-pulse rounded-full bg-stone-100" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !error && pf_providers.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-stone-100 shadow-sm">
            <h3 className="text-xl font-medium text-stone-800 mb-2">No pf_providers found</h3>
            <p className="text-stone-500">Try adjusting your filters or searching a different area.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleProviders.map((provider, index) => {
              const isFeaturedResult = index === 0
              const currentFeaturedStatus = featuredLoadStatus[provider.id] || 'idle'
              const shouldRenderSearchFeedbackCard = index === searchFeedbackInsertIndex

              const profileQuery = new URLSearchParams()
              if (isFeaturedResult) {
                profileQuery.set('featured', '1')
              }
              if (provider.category) {
                profileQuery.set('category', provider.category)
              }

              return (
                <div key={provider.id} className="space-y-4">
                  <Link
                    href={`/provider/${encodeURIComponent(provider.id)}${profileQuery.toString() ? `?${profileQuery.toString()}` : ''}`}
                    className="block group"
                  >
                    <div className={`rounded-2xl border p-4 shadow-sm transition-all group-hover:border-stone-200 group-hover:shadow-md sm:p-5 ${isFeaturedResult ? 'bg-[#fffdf8] border-[#e7d7a6]' : 'bg-white border-stone-100'}`}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    <div className="relative h-24 w-24 overflow-hidden rounded-2xl border border-stone-100 bg-stone-50 sm:h-24 sm:w-24 sm:flex-shrink-0">
                          <ProviderImage
                        photoReference={provider.photo_reference}
                            alt={provider.name}
                            sizes="96px"
                            priority={isFeaturedResult}
                          />
                        </div>

                        <div className="flex-1">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
                              {isFeaturedResult && (
                                <div className="mb-2 inline-flex items-center rounded-sm bg-[#f6edd1] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8a6d1f]">
                                  {getFeaturedLabel()}
                                </div>
                              )}
                              <h3 className="flex items-start gap-2 text-xl font-medium text-stone-900 transition-colors group-hover:text-[#e07a5f]">
                                {provider.name}
                                {(provider.subscription_tier === 'verified' || provider.subscription_tier === 'premium') && (
                                  <CheckCircle className="mt-1 h-4 w-4 flex-shrink-0 text-green-500" />
                                )}
                              </h3>
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
                                <span className="font-medium uppercase tracking-[0.18em] text-[11px] text-stone-400">
                                  {formatCategoryLabel(provider.category)}
                                </span>
                                <span className="hidden h-1 w-1 rounded-full bg-stone-300 sm:block" />
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-stone-400" />
                                  <span className="truncate">{provider.address || provider.postcode}</span>
                                </div>
                                {typeof provider.distance_miles === 'number' && (
                                  <>
                                    <span className="hidden h-1 w-1 rounded-full bg-stone-300 sm:block" />
                                    <span>{provider.distance_miles} miles</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              {provider.google_rating ? (
                                <div className="collar-tag collar-tag-small text-sm font-semibold">
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-[10px] font-black text-[#6A5121] shadow-sm">
                                    G
                                  </span>
                                  <span>{provider.google_rating.score}</span>
                                  <span className="rounded-full bg-white/65 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7A5A19]">
                                    {provider.google_rating.count}
                                  </span>
                                </div>
                              ) : provider.native_rating ? (
                                <div className="inline-flex items-center rounded-full border border-[#829e8d]/20 bg-[#829e8d]/8 px-3 py-1.5 text-sm font-semibold text-[#6c8676] shadow-sm">
                                  <Star className="mr-1.5 h-3.5 w-3.5 fill-current" />
                                  {provider.native_rating.score}
                                  <span className="ml-1.5 text-xs font-medium text-[#6c8676]/80">({provider.native_rating.count})</span>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {getPrimaryTags(provider).map((tag: string) => (
                              <span
                                key={`tag-${provider.id}-${tag}`}
                                className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-stone-600"
                              >
                                {tag.startsWith('general_') ? formatGeneralCoverageLabel(tag) : tag}
                              </span>
                            ))}
                            {getPrimaryTags(provider).length === 0 && (
                              <span className="rounded-full bg-stone-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
                                More details on profile
                              </span>
                            )}
                          </div>

                          {provider.breed_match_type === 'general_inferred' && (
                            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-600">
                              Breed match is based on general animal coverage inferred from the business website, not a confirmed breed specialism.
                            </div>
                          )}

                          {isFeaturedResult && (
                            <div className="mt-4 border-t border-stone-200 pt-4">
                              {currentFeaturedStatus === 'loading' && (
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="h-3 w-36 animate-pulse rounded-full bg-stone-200" />
                                    <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-stone-100" />
                                  </div>
                                  <div className="h-4 w-24 animate-pulse rounded-full bg-stone-100" />
                                </div>
                              )}

                              {currentFeaturedStatus === 'ready' && provider.ai_summary && (
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
                                      User Review Summary
                                    </div>
                                    <p className="mt-2 line-clamp-1 text-sm leading-6 text-stone-700">
                                      {provider.ai_summary}
                                    </p>
                                  </div>
                                  <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-stone-500 transition-colors group-hover:text-[#829e8d]">
                                    View Profile &rarr;
                                  </span>
                                </div>
                              )}

                              {currentFeaturedStatus === 'delayed' && (
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="text-sm leading-6 text-stone-500">
                                    We&apos;re still analysing this business. Check back shortly for the review summary.
                                  </p>
                                  <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                                    View Profile &rarr;
                                  </span>
                                </div>
                              )}

                              {currentFeaturedStatus === 'error' && (
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="text-sm leading-6 text-stone-500">
                                    The review summary is temporarily unavailable. Open the profile for the full view.
                                  </p>
                                  <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                                    View Profile &rarr;
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {!isFeaturedResult && (
                            <div className="mt-4 flex items-center justify-end border-t border-stone-100 pt-4">
                              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500 transition-colors group-hover:text-[#829e8d]">
                                View Profile &rarr;
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>

                  {shouldRenderSearchFeedbackCard ? (
                    <InlineSearchFeedbackCard
                      key={searchFeedbackSessionKey}
                      searchQuery={searchFeedbackQuery}
                      resultsCount={visibleProviders.length}
                      sessionKey={searchFeedbackSessionKey}
                    />
                  ) : null}
                </div>
              )
            })}

            {hasMoreResults && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + RESULTS_PAGE_SIZE)}
                  className="rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold text-stone-700 shadow-sm transition-colors hover:bg-stone-50"
                >
                  Load 5 More Businesses
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default function SearchPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <Suspense fallback={<div className="p-8 text-center">Loading search...</div>}>
        <SearchContent />
      </Suspense>
    </div>
  )
}
