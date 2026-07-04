'use client'

import { useState, useEffect, Suspense, useRef, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowDownWideNarrow, CheckCircle, Filter, MapPin, Star } from 'lucide-react'
import { BREED_OPTIONS } from '@/lib/breed-taxonomy'
import { ProviderImage } from '@/components/ProviderImage'

type FeaturedLoadStatus = 'idle' | 'loading' | 'ready' | 'delayed' | 'error'
type SortOption = 'distance' | 'rating' | 'review_count'

function SearchContent() {
  const RESULTS_PAGE_SIZE = 5
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
  const [pf_providers, setProviders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [featuredLoadStatus, setFeaturedLoadStatus] = useState<Record<string, FeaturedLoadStatus>>({})
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE)
  const [sortBy, setSortBy] = useState<SortOption>('distance')
  const lastAutoFetchKeyRef = useRef<string | null>(null)

  const [filters, setFilters] = useState({
    postcode: searchParams.get('postcode') || '',
    animal: searchParams.get('animal') || '',
    category: searchParams.get('category') || '',
    service: searchParams.get('service') || '',
    breed: searchParams.get('breed') || ''
  })

  useEffect(() => {
    // When searchParams change (like a new postcode is entered), update filters and fetch
    const nextFilters = {
      postcode: searchParams.get('postcode') || filters.postcode,
      animal: searchParams.get('animal') || filters.animal,
      category: searchParams.get('category') || filters.category,
      service: searchParams.get('service') || filters.service,
      breed: searchParams.get('breed') || filters.breed
    }
    console.log('[search-page] sync searchParams -> filters', {
      currentFilters: filters,
      nextFilters,
      href: window.location.href,
    })
    setFilters(prev => ({
      ...prev,
      postcode: searchParams.get('postcode') || prev.postcode,
      animal: searchParams.get('animal') || prev.animal,
      category: searchParams.get('category') || prev.category,
      service: searchParams.get('service') || prev.service,
      breed: searchParams.get('breed') || prev.breed
    }))
  }, [searchParams])

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
      fetchProviders()
    }
  }, [filters, selectedLat, selectedLng, selectedLocationLabel]) // Auto-fetch once per distinct URL-derived filter state

  const fetchFeaturedEnrichment = async (providerId: string) => {
    setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: 'loading' }))

    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/featured-enrichment`, {
        signal: AbortSignal.timeout(15000),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load featured details')
      }

      setProviders((prev) =>
        prev.map((provider) => (provider.id === providerId ? { ...provider, ...data } : provider))
      )
      setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: 'ready' }))
    } catch (err: any) {
      const nextStatus: FeaturedLoadStatus =
        err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'delayed' : 'error'
      setFeaturedLoadStatus((prev) => ({ ...prev, [providerId]: nextStatus }))
    }
  }

  const fetchProviders = async () => {
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
      
      const providers = data.pf_providers || []
      setProviders(providers)

    } catch (err: any) {
      console.error('[search-page] fetchProviders error', {
        message: err?.message ?? String(err),
        stack: err?.stack ?? null,
        filters,
        href: window.location.href,
      })
      setError(err.message)
      setProviders([])
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key: string, value: string) => {
    lastAutoFetchKeyRef.current = null
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const getSortMetrics = (provider: any) => {
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

  const hasMoreResults = visibleCount < sortedProviders.length

  useEffect(() => {
    const featuredProvider = sortedProviders[0]
    if (!featuredProvider?.id) return

    const status = featuredLoadStatus[featuredProvider.id]
    if (status === 'loading' || status === 'ready') return

    fetchFeaturedEnrichment(featuredProvider.id)
  }, [sortedProviders, featuredLoadStatus])

  const getPrimaryTags = (provider: any) => {
    if (provider.services?.length) return provider.services.slice(0, 2)
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

  const formatCategoryLabel = (value: string) =>
    value
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
      {/* Sidebar */}
      <aside className="w-full flex-shrink-0">
        <div className="rounded-2xl border border-stone-100 bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-4">
          <div className="mb-3 flex items-center gap-2">
            <Filter className="h-4 w-4 text-stone-500" />
            <h2 className="text-base font-semibold text-stone-800">Filters</h2>
          </div>
          
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Category</label>
              <select 
                value={filters.category}
                onChange={(e) => handleFilterChange('category', e.target.value)}
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
                value={filters.breed}
                onChange={(e) => handleFilterChange('breed', e.target.value)}
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
                onChange={(e) => {
                  setSortBy(e.target.value as SortOption)
                  setVisibleCount(RESULTS_PAGE_SIZE)
                }}
                className="w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:border-[#829e8d] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#829e8d]"
              >
                <option value="distance">Distance</option>
                <option value="rating">Review Star</option>
                <option value="review_count">Review Count</option>
              </select>
            </div>

            <div>
              <button 
                onClick={fetchProviders}
                className="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 md:w-auto md:min-w-[126px]"
              >
                Apply
              </button>
            </div>
            
            <p className="text-[11px] leading-relaxed text-stone-400 md:col-span-4 md:pt-1">
              Filter results are most accurate for verified providers. Unclaimed businesses are included by default.
            </p>
          </div>
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

              const profileQuery = new URLSearchParams()
              if (isFeaturedResult) {
                profileQuery.set('featured', '1')
              }
              if (provider.category) {
                profileQuery.set('category', provider.category)
              }

              return (
              <Link
                href={`/provider/${encodeURIComponent(provider.id)}${profileQuery.toString() ? `?${profileQuery.toString()}` : ''}`}
                key={provider.id}
                className="block group"
              >
                  <div className={`rounded-2xl border p-4 shadow-sm transition-all group-hover:border-stone-200 group-hover:shadow-md sm:p-5 ${isFeaturedResult ? 'bg-[#fffdf8] border-[#e7d7a6]' : 'bg-white border-stone-100'}`}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    {/* Image Thumbnail */}
                    <div className={`relative h-24 w-24 overflow-hidden rounded-2xl border border-stone-100 bg-stone-50 sm:h-24 sm:w-24 sm:flex-shrink-0 ${!isFeaturedResult && provider.subscription_tier !== 'premium' ? 'blur-[2px]' : ''}`}>
                      <ProviderImage
                        photoReference={(isFeaturedResult || provider.subscription_tier === 'premium') ? provider.photo_reference : null}
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
                          <div className="inline-flex items-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-stone-700 shadow-sm">
                            <Star className="mr-1.5 h-3.5 w-3.5 fill-current text-[#e07a5f]" />
                            {provider.google_rating.score}
                            <span className="ml-1.5 text-xs font-medium text-stone-500">({provider.google_rating.count})</span>
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
            )})}

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
