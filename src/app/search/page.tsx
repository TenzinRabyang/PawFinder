'use client'

import { useState, useEffect, Suspense, useRef, useMemo, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowDownWideNarrow, CheckCircle, Filter, MapPin, Star, X } from 'lucide-react'
import BrandLogo from '@/components/brand/BrandLogo'
import { ProviderImage } from '@/components/ProviderImage'
import InlineSearchFeedbackCard from '@/components/search/InlineSearchFeedbackCard'
import NoResultsFeedback from '@/components/search/NoResultsFeedback'
import SearchFilters, {
  type SearchFilterState,
  type SortOption,
  type TargetSpecies,
  normalizeBreedTag,
  sanitizeFiltersForCategory,
} from '@/components/search/SearchFilters'
import { consumeDailyUsage } from '@/lib/daily-client-limits'
import { removeCategoryDuplicateServices } from '@/lib/provider-name-service-inference'
import { primeProviderSessionCache } from '@/lib/provider-session-cache'

type FeaturedLoadStatus = 'idle' | 'loading' | 'ready' | 'delayed' | 'error'
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

const SPECIES_LABELS: Record<TargetSpecies, string> = {
  dogs: 'Dogs',
  cats: 'Cats',
  birds: 'Birds',
  small_animals: 'Small Animals',
  reptiles_exotics: 'Reptiles / Exotics',
}

const PROVIDER_SPECIES_TOKEN_MAP: Record<TargetSpecies, string[]> = {
  dogs: ['dog', 'dogs', 'canine'],
  cats: ['cat', 'cats', 'feline'],
  birds: ['bird', 'birds', 'avian'],
  small_animals: [
    'small_animal',
    'small_animals',
    'rabbit',
    'rabbits',
    'guinea_pig',
    'guinea_pigs',
    'hamster',
    'hamsters',
    'ferret',
    'ferrets',
    'rodent',
    'rodents',
  ],
  reptiles_exotics: ['reptile', 'reptiles', 'exotic', 'exotics'],
}

const LOCATION_REQUEST_TIMEOUT_MS = 15000
const POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i
const SEARCH_DAILY_LIMIT = 10
const SEARCH_DAILY_LIMIT_STORAGE_KEY = 'pawfinder_search_count'
const SEARCH_DAILY_LIMIT_MESSAGE =
  'Daily search limit reached to keep PawFinder free for everyone. Come back tomorrow! 🐾'

function normalizeUrlToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s/+-]+/g, '_')
}

function dedupeValues(values: string[]) {
  return Array.from(new Set(values))
}

function parseSpeciesValues(values: string[]): TargetSpecies[] {
  return dedupeValues(values)
    .filter(
      (value): value is TargetSpecies =>
        value === 'dogs' ||
        value === 'cats' ||
        value === 'birds' ||
        value === 'small_animals' ||
        value === 'reptiles_exotics'
    )
}

function getQueryList(searchParams: ReturnType<typeof useSearchParams>, key: string) {
  return dedupeValues(
    searchParams
      .getAll(key)
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function setListParam(searchParams: URLSearchParams, key: string, values: string[]) {
  searchParams.delete(key)
  values.forEach((value) => searchParams.append(key, value))
}

function getProviderSpeciesCoverage(provider: SearchProvider) {
  const rawTokens = [
    ...(provider.animals_served || []),
    ...(provider.breeds_general_inferred || []),
  ].map(normalizeUrlToken)

  if (rawTokens.length === 0) {
    return null
  }

  const coverage = new Set<TargetSpecies>()

  for (const [speciesKey, providerTokens] of Object.entries(PROVIDER_SPECIES_TOKEN_MAP) as Array<
    [TargetSpecies, string[]]
  >) {
    if (providerTokens.some((token) => rawTokens.includes(token))) {
      coverage.add(speciesKey)
    }
  }

  return coverage
}

function providerMatchesSpecies(provider: SearchProvider, selectedSpecies: TargetSpecies[]) {
  if (selectedSpecies.length === 0) return true

  const coverage = getProviderSpeciesCoverage(provider)
  if (!coverage || coverage.size === 0) {
    return true
  }

  return selectedSpecies.every((species) => coverage.has(species))
}

function formatSearchIntentTerm(filters: SearchFilterState) {
  const segments: string[] = []

  if (filters.category) {
    segments.push(filters.category === 'pet_shop' ? 'pet shop' : filters.category)
  }

  if (filters.species.length > 0) {
    segments.push(filters.species.map((species) => SPECIES_LABELS[species]).join(', '))
  }

  if (filters.careType) {
    segments.push(filters.careType.replace(/_/g, ' '))
  }

  if (filters.environment) {
    segments.push(filters.environment.replace(/_/g, ' '))
  }

  if (filters.capabilities.length > 0) {
    segments.push(filters.capabilities.map((value) => value.replace(/_/g, ' ')).join(', '))
  }

  if (filters.breedTags.length > 0) {
    segments.push(filters.breedTags.join(', '))
  }

  if (filters.handlingNeeds.length > 0) {
    segments.push(filters.handlingNeeds.map((value) => value.replace(/_/g, ' ')).join(', '))
  }

  if (filters.isEmergency247) segments.push('24/7 emergency')
  if (filters.offersHouseCalls) segments.push('house calls / mobile')
  if (filters.hasRawPrescriptionDiets) segments.push('raw / prescription diets')

  return segments.join(' • ') || 'General pet care search'
}

function getActiveFilterChips(filters: SearchFilterState, locationLabel: string) {
  const chips: string[] = []

  if (locationLabel) chips.push(locationLabel)
  if (filters.category) chips.push(filters.category === 'pet_shop' ? 'Pet Shop' : filters.category)
  filters.species.forEach((species) => chips.push(SPECIES_LABELS[species]))

  if (filters.careType) chips.push(filters.careType.replace(/_/g, ' '))
  if (filters.environment) chips.push(filters.environment.replace(/_/g, ' '))
  filters.capabilities.forEach((capability) => chips.push(capability.replace(/_/g, ' ')))
  filters.breedTags.forEach((breedTag) => chips.push(`Breed: ${breedTag}`))
  filters.handlingNeeds.forEach((handlingNeed) => chips.push(handlingNeed.replace(/_/g, ' ')))
  if (filters.isEmergency247) chips.push('24/7 emergency')
  if (filters.offersHouseCalls) chips.push('House calls / mobile')
  if (filters.hasRawPrescriptionDiets) chips.push('Raw / prescription diets')

  return dedupeValues(chips)
}

function SearchContent() {
  const RESULTS_PAGE_SIZE = 5
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedLat = searchParams.get('lat')
  const selectedLng = searchParams.get('lng')
  const selectedLocationLabel = searchParams.get('location')
  const [pf_providers, setProviders] = useState<SearchProvider[]>([])
  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [searchLimitMessage, setSearchLimitMessage] = useState<string | null>(null)
  const [isApplyingFilters, setIsApplyingFilters] = useState(false)
  const [featuredLoadStatus, setFeaturedLoadStatus] = useState<Record<string, FeaturedLoadStatus>>({})
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE)
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const lastAutoFetchKeyRef = useRef<string | null>(null)
  const activeLocationLabel = selectedLocationLabel || searchParams.get('postcode') || ''
  const filters = useMemo<SearchFilterState>(
    () =>
      sanitizeFiltersForCategory({
        location: activeLocationLabel,
        category:
          searchParams.get('category') === 'sitter' ||
          searchParams.get('category') === 'groomer' ||
          searchParams.get('category') === 'vet' ||
          searchParams.get('category') === 'pet_shop'
            ? (searchParams.get('category') as SearchFilterState['category'])
            : '',
        species: parseSpeciesValues(getQueryList(searchParams, 'species')),
        careType:
          searchParams.get('careType') === 'overnight_stay' ||
          searchParams.get('careType') === 'day_visit' ||
          searchParams.get('careType') === 'drop_in'
            ? (searchParams.get('careType') as SearchFilterState['careType'])
            : '',
        environment:
          searchParams.get('environment') === 'solo_pet_environment' ||
          searchParams.get('environment') === 'multi_pet_friendly'
            ? (searchParams.get('environment') as SearchFilterState['environment'])
            : '',
        capabilities: getQueryList(searchParams, 'capability').filter(
          (
            value
          ): value is SearchFilterState['capabilities'][number] =>
            value === 'medication_administration' ||
            value === 'senior_special_care' ||
            value === 'constant_supervision'
        ),
        breedTags: getQueryList(searchParams, 'breedTag').map(normalizeBreedTag).filter(Boolean),
        handlingNeeds: getQueryList(searchParams, 'handlingNeed').filter(
          (
            value
          ): value is SearchFilterState['handlingNeeds'][number] =>
            value === 'anxious_fear_free' ||
            value === 'giant_breeds_50kg_plus' ||
            value === 'double_coat_de_shedding'
        ),
        isEmergency247: searchParams.get('emergency247') === 'true',
        offersHouseCalls: searchParams.get('houseCalls') === 'true',
        hasRawPrescriptionDiets: searchParams.get('rawDiets') === 'true',
      }),
    [activeLocationLabel, searchParams]
  )
  const sortBy = useMemo<SortOption>(() => {
    const requestedSort = searchParams.get('sort')

    if (requestedSort === 'rating' || requestedSort === 'review_count' || requestedSort === 'distance') {
      return requestedSort
    }

    return 'distance'
  }, [searchParams])

  const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  const getErrorName = (error: unknown) => (error instanceof Error ? error.name : '')
  const readJsonSafely = useCallback(async (response: Response) => {
    try {
      return (await response.json()) as Record<string, unknown>
    } catch {
      return {}
    }
  }, [])

  const fetchFeaturedEnrichment = useCallback(async (providerId: string) => {
    setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: 'loading' }))

    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/featured-enrichment`, {
        signal: AbortSignal.timeout(15000),
      })
      const data = (await readJsonSafely(res)) as FeaturedEnrichmentResponse

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
    if (searchParams.get('postcode')) params.append('postcode', searchParams.get('postcode') || '')
    if (selectedLat && selectedLng) {
      params.append('lat', selectedLat)
      params.append('lng', selectedLng)
    }
    if (selectedLocationLabel) params.append('location', selectedLocationLabel)
    if (filters.category) params.append('category', filters.category)
    const requestUrl =
      selectedLat && selectedLng
        ? `/api/providers/search-by-location?${params.toString()}`
        : `/api/providers/search?${params.toString()}`
    try {
      const res = await fetch(requestUrl)
      const data = await readJsonSafely(res)
      
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string' && data.error
            ? data.error
            : 'Unable to load search results right now. Please try again.'
        )
      }
      
      const providers = (data.pf_providers || []) as SearchProvider[]
      for (const provider of providers) {
        primeProviderSessionCache(provider.google_place_id || provider.id, {
          providerSnapshot: provider,
        })
      }
      setProviders(providers)

    } catch (err: unknown) {
      setError(getErrorMessage(err))
      setProviders([])
    } finally {
      setLoading(false)
    }
  }, [RESULTS_PAGE_SIZE, filters.category, readJsonSafely, searchParams, selectedLat, selectedLng, selectedLocationLabel])

  useEffect(() => {
    // Automatically fetch providers when filters state updates from the URL
    if (!searchParams.get('postcode') && !(selectedLat && selectedLng)) {
      setLoading(false)
      setProviders([])
      return
    }

    const autoFetchKey = JSON.stringify({
      postcode: searchParams.get('postcode') || '',
      lat: selectedLat,
      lng: selectedLng,
      category: filters.category,
    })

    if ((searchParams.get('postcode') || (selectedLat && selectedLng)) && lastAutoFetchKeyRef.current !== autoFetchKey) {
      lastAutoFetchKeyRef.current = autoFetchKey
      void fetchProviders()
    }
  }, [fetchProviders, filters.category, searchParams, selectedLat, selectedLng])

  const updateSortUrl = (nextSortBy: SortOption) => {
    const nextParams = new URLSearchParams(searchParams.toString())

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

  const handleApplyFilters = useCallback(async (nextFilters: SearchFilterState) => {
    setLocationError(null)
    const nextDailyUsage = consumeDailyUsage(SEARCH_DAILY_LIMIT_STORAGE_KEY, SEARCH_DAILY_LIMIT)

    if (!nextDailyUsage.allowed) {
      setSearchLimitMessage(SEARCH_DAILY_LIMIT_MESSAGE)
      return
    }

    setSearchLimitMessage(null)
    setVisibleCount(RESULTS_PAGE_SIZE)
    lastAutoFetchKeyRef.current = null
    setIsApplyingFilters(true)

    try {
      const cleanedFilters = sanitizeFiltersForCategory(nextFilters)
      const resolvedLocation = await resolveLocationDraft(cleanedFilters.location)
      const nextParams = new URLSearchParams(searchParams.toString())

      if (cleanedFilters.category) {
        nextParams.set('category', cleanedFilters.category)
      } else {
        nextParams.delete('category')
      }

      setListParam(nextParams, 'species', cleanedFilters.species)
      setListParam(nextParams, 'capability', cleanedFilters.capabilities)
      setListParam(nextParams, 'breedTag', cleanedFilters.breedTags)
      setListParam(nextParams, 'handlingNeed', cleanedFilters.handlingNeeds)

      if (cleanedFilters.careType) nextParams.set('careType', cleanedFilters.careType)
      else nextParams.delete('careType')

      if (cleanedFilters.environment) nextParams.set('environment', cleanedFilters.environment)
      else nextParams.delete('environment')

      if (cleanedFilters.isEmergency247) nextParams.set('emergency247', 'true')
      else nextParams.delete('emergency247')

      if (cleanedFilters.offersHouseCalls) nextParams.set('houseCalls', 'true')
      else nextParams.delete('houseCalls')

      if (cleanedFilters.hasRawPrescriptionDiets) nextParams.set('rawDiets', 'true')
      else nextParams.delete('rawDiets')

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
      setIsFiltersOpen(false)
    } catch (applyError) {
      setLocationError(applyError instanceof Error ? applyError.message : 'Unable to update the search area.')
    } finally {
      setIsApplyingFilters(false)
    }
  }, [pathname, resolveLocationDraft, router, searchParams])

  const handleSortChange = (value: SortOption) => {
    setVisibleCount(RESULTS_PAGE_SIZE)
    updateSortUrl(value)
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

  const filteredProviders = useMemo(
    () => pf_providers.filter((provider) => providerMatchesSpecies(provider, filters.species)),
    [filters.species, pf_providers]
  )

  const sortedProviders = useMemo(() => {
    const providers = [...filteredProviders]

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
  }, [filteredProviders, sortBy])

  const visibleProviders = useMemo(
    () => sortedProviders.slice(0, visibleCount),
    [sortedProviders, visibleCount]
  )
  const searchFeedbackQuery = activeLocationLabel || 'this area'
  const searchFeedbackSessionKey = useMemo(
    () => `pawfinder:inline-search-feedback:${searchParams.toString() || 'default'}`,
    [searchParams]
  )
  const searchFeedbackInsertIndex = useMemo(
    () => (visibleProviders.length > 0 ? Math.min(2, visibleProviders.length - 1) : -1),
    [visibleProviders.length]
  )
  const activeFilterChips = useMemo(
    () => getActiveFilterChips(filters, activeLocationLabel),
    [activeLocationLabel, filters]
  )
  const hasActiveFilters = activeFilterChips.length > 0

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
          <div>
            <Link
              href="/"
              className="inline-flex transition-colors hover:text-[#B14A2B]"
            >
              <BrandLogo
                iconSize={48}
                priority
                wordmarkClassName="font-display text-[1.55rem] tracking-[-0.03em] text-[#20261F]"
              />
            </Link>
            <p className="mt-0.5 text-sm text-[#6C675E]">
              Search by care needs, species, and local context in one place.
            </p>
          </div>
        </div>
      </header>

      <div className="rounded-2xl border border-stone-100 bg-white px-4 py-3 shadow-sm sm:px-5">
        <div className="flex flex-wrap items-center gap-2 sm:justify-between">
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFiltersOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-stone-400 hover:bg-stone-50"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters ? (
                <span className="inline-flex min-w-[1.3rem] items-center justify-center rounded-full bg-[#3D5A45] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activeFilterChips.length}
                </span>
              ) : null}
            </button>

            <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              Sort
              <select
                value={sortBy}
                onChange={(event) => handleSortChange(event.target.value as SortOption)}
                className="bg-transparent text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-700 outline-none"
              >
                <option value="distance">Distance</option>
                <option value="rating">Review Star</option>
                <option value="review_count">Review Count</option>
              </select>
            </div>
          </div>

          {hasActiveFilters ? (
            <p className="text-xs text-stone-500">
              {activeFilterChips.length} active filter{activeFilterChips.length === 1 ? '' : 's'} applied
            </p>
          ) : (
            <p className="text-xs text-stone-500">Tap filters to refine species, care needs, and category.</p>
          )}
        </div>

        {hasActiveFilters ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeFilterChips.slice(0, 8).map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-[#D8C4A6] bg-[#FFF8ED] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6A5121]"
              >
                {chip}
              </span>
            ))}
            {activeFilterChips.length > 8 ? (
              <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                +{activeFilterChips.length - 8} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {isFiltersOpen ? (
        <div
          className="fixed inset-0 z-[90] bg-stone-900/40 backdrop-blur-sm"
          onClick={() => setIsFiltersOpen(false)}
          role="presentation"
        >
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-stone-200 bg-[#FAF9F6] p-4 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search filters"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C5B4D]">
                  Filter Panel
                </p>
                <h2 className="mt-1 text-lg font-semibold text-stone-900">Refine Your Search</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsFiltersOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition hover:border-stone-300 hover:text-stone-900"
                aria-label="Close filters"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <SearchFilters
              initialState={filters}
              sortBy={sortBy}
              isApplyingFilters={isApplyingFilters}
              locationError={locationError}
              searchLimitMessage={searchLimitMessage}
              onApply={handleApplyFilters}
              onSortChange={handleSortChange}
              showSortControl={false}
            />
          </aside>
        </div>
      ) : null}

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
        ) : !error && sortedProviders.length === 0 ? (
          <NoResultsFeedback
            searchTerm={formatSearchIntentTerm(filters)}
            category={filters.category ? formatCategoryLabel(filters.category) : null}
            species={filters.species.map((species) => SPECIES_LABELS[species])}
            location={activeLocationLabel || null}
          />
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
