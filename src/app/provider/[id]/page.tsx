'use client'

import { useState, useEffect, use } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Star, MapPin, CheckCircle, Info, ShieldCheck, Copy, Check } from 'lucide-react'
import Link from 'next/link'
import { BREED_OPTIONS } from '@/lib/breed-taxonomy'
import { ProviderImage } from '@/components/ProviderImage'
import { resolveProviderCategory } from '@/lib/provider-category'
import {
  getBreedAnalysisStatus,
  shouldAutoRetryBreedAnalysis,
  shouldRefreshIncompleteBreedCoverage,
} from '@/lib/provider-analysis-state'

export default function ProviderProfile({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const id = resolvedParams.id
  const searchParams = useSearchParams()
  const isFeaturedProfile = searchParams.get('featured') === '1'
  const requestedCategory = searchParams.get('category')
  
  const supabase = createClient()
  const [provider, setProvider] = useState<any>(null)
  const [pf_reviews, setReviews] = useState<any[]>([])
  const [liveDetails, setLiveDetails] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('Loading profile...')
  const [breedTagStatus, setBreedTagStatus] = useState<
    | 'idle'
    | 'loading'
    | 'generating'
    | 'confirmed'
    | 'retrying'
    | 'unavailable'
    | 'services_only'
    | 'delayed'
    | 'fetch_blocked'
    | 'no_website'
    | 'category_unresolved'
  >('idle')
  const [user, setUser] = useState<any>(null)
  const [showCallPopup, setShowCallPopup] = useState(false)
  const [showCopiedState, setShowCopiedState] = useState(false)
  const [reviewSubmitState, setReviewSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Review Form State
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    dog_breed: '',
    handling_rating: 5,
    environment_rating: 5,
    comment: '',
    temperament_tags: [] as string[]
  })

  const normalizeExternalUrl = (url: string | null | undefined) => {
    if (!url) return null
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return null
    return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
  }

  const getDisplayPhoneNumber = (phone: string | null | undefined) => {
    if (!phone) return null
    const trimmedPhone = phone.trim()
    return trimmedPhone || null
  }

  const formatCategoryLabel = (value: string | null | undefined) => {
    if (!value) return null
    return value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  const formatServiceLabel = (value: string) =>
    value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')

  const getBreedStatusMessage = (status: typeof breedTagStatus) => {
    switch (status) {
      case 'confirmed':
        return 'Animal coverage has been confirmed, but no breed-specific support was saved yet.'
      case 'fetch_blocked':
        return "We weren't able to access this business's website for automatic analysis."
      case 'retrying':
        return "We're still gathering breed info for this business."
      case 'no_website':
        return "This business hasn't listed a website, so we can't automatically analyse their services and breed coverage yet."
      case 'category_unresolved':
        return "We couldn't classify this business from the available listing data yet, so automatic website analysis hasn't started."
      case 'unavailable':
        return 'Breed coverage could not be confirmed from the business website.'
      case 'services_only':
        return "We found this business's services, but couldn't confirm which animals or breeds they support from the website."
      case 'delayed':
        return 'We are still analysing this business. Check back shortly for saved breed coverage.'
      default:
        return 'Breed coverage is not available for this profile yet.'
    }
  }

  const getReviewAverage = (review: any) => Number((((review.handling_rating || 0) + (review.environment_rating || 0)) / 2).toFixed(1))

  const getReviewerInitials = (name: string | null | undefined) =>
    (name || 'Anonymous User')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')

  const breedLabelMap = new Map<string, string>(BREED_OPTIONS.map((breed) => [breed.value, breed.label]))
  const breedAnimalMap = new Map<string, string>(BREED_OPTIONS.map((breed) => [breed.value, breed.animal]))
  const getBreedLabel = (value: string) => breedLabelMap.get(value) || formatServiceLabel(value)
  const displayedBreedValues = Array.isArray(provider?.breeds_specialised) ? provider.breeds_specialised : []
  const generalCoverageAnimals = Array.isArray(provider?.breeds_general_inferred) ? provider.breeds_general_inferred : []
  const supportedAnimals = Array.isArray(provider?.animals_served) ? provider.animals_served : []
  const groupedBreeds = displayedBreedValues.reduce(
        (groups: Record<string, string[]>, breed: string) => {
          const animal = breedAnimalMap.get(breed) || 'other'
          if (!groups[animal]) groups[animal] = []
          if (!groups[animal].includes(breed)) {
            groups[animal].push(breed)
          }
          return groups
        },
        {}
      )
  const generalCoverageLabels = generalCoverageAnimals.map((animal: string) =>
    animal === 'dog' ? 'Dogs' : animal === 'cat' ? 'Cats' : animal === 'rabbit' ? 'Rabbits' : animal
  )
  const supportedAnimalLabels = supportedAnimals.map((animal: string) =>
    animal === 'dog' ? 'Dogs' : animal === 'cat' ? 'Cats' : animal === 'rabbit' ? 'Rabbits' : animal
  )
  const displayedServiceCategories = [
    formatCategoryLabel(provider?.category),
    ...(Array.isArray(provider?.services) ? provider.services.map(formatServiceLabel) : []),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  const isAnalysisPending = breedTagStatus === 'loading' || breedTagStatus === 'generating'
  const analysisLoadingLabel =
    breedTagStatus === 'generating' ? 'Analysing this business...' : 'Checking saved profile details...'

  const nativeRatingSummary =
    pf_reviews.length > 0
      ? {
          score: Number(
            (
              pf_reviews.reduce(
                (acc, review) => acc + ((review.handling_rating || 0) + (review.environment_rating || 0)) / 2,
                0
              ) / pf_reviews.length
            ).toFixed(1)
          ),
          count: pf_reviews.length,
        }
      : null

  useEffect(() => {
    fetchData()
  }, [id, isFeaturedProfile, requestedCategory])

  const refreshSavedWebsiteAnalysis = async (placeId: string, baseProvider: any, website: string, liveData: any) => {
    setBreedTagStatus('generating')

    try {
      const ensureTagsRes = await fetch(`/api/providers/${encodeURIComponent(placeId)}/ensure-tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: baseProvider.name,
          address: baseProvider.address,
          category: baseProvider.category,
          googleTypes: liveData.types || [],
          website,
          phone: liveData.formatted_phone_number || baseProvider.phone,
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (ensureTagsRes.ok && ensureTagsRes.headers.get('content-type')?.includes('application/json')) {
        const ensureTagsData = await ensureTagsRes.json()
        if (ensureTagsData.provider) {
          const ensuredProvider = ensureTagsData.provider
          const mergedProvider = {
            ...ensuredProvider,
            name: liveData.name || ensuredProvider.name,
            address: liveData.formatted_address || ensuredProvider.address,
            website: liveData.website || ensuredProvider.website,
            phone: liveData.formatted_phone_number || ensuredProvider.phone,
          }

          setProvider((currentProvider: any) =>
            currentProvider?.google_place_id === placeId ? { ...currentProvider, ...mergedProvider } : mergedProvider
          )

          const nextStatus = ensureTagsData.analysis_status || getBreedAnalysisStatus(mergedProvider)
          setBreedTagStatus(nextStatus)
          return
        }
      }

      if (!ensureTagsRes.ok) {
        let errorPayload: unknown = null

        try {
          const contentType = ensureTagsRes.headers.get('content-type') || ''
          errorPayload = contentType.includes('application/json')
            ? await ensureTagsRes.json()
            : await ensureTagsRes.text()
        } catch {
          errorPayload = null
        }

        console.error('[provider-page] ensure-tags returned non-OK response', {
          placeId,
          status: ensureTagsRes.status,
          errorPayload,
        })

        const errorMessage =
          typeof errorPayload === 'string'
            ? errorPayload
            : errorPayload && typeof errorPayload === 'object' && 'error' in errorPayload
            ? String((errorPayload as { error?: unknown }).error || '')
            : ''

        setBreedTagStatus(
          errorMessage.includes('Unable to determine a valid provider category')
            ? 'category_unresolved'
            : 'unavailable'
        )
        return
      }

      setBreedTagStatus(getBreedAnalysisStatus(baseProvider))
    } catch (error: any) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        console.warn('[provider-page] ensure-tags timed out', { id: placeId })
        setBreedTagStatus('delayed')
        return
      }

      console.error('[provider-page] ensure-tags failed', error)
      setBreedTagStatus('unavailable')
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setLoadingMessage('Loading profile...')
    setBreedTagStatus('loading')
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setUser(user)
      })
      .catch((error) => {
        console.error('Failed to load current user for provider page', error)
      })

    // Since 'id' is now the Google Place ID from the search page
    // 1. Fetch live details from Google Places first
    try {
      const detailsUrl = `/api/providers/${encodeURIComponent(id)}/live-details`
      let res: Response | null = null
      try {
        res = await fetch(detailsUrl, { signal: AbortSignal.timeout(15000) })
      } catch (error: any) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
          console.warn('[provider-page] live details timed out', { id, detailsUrl })
        } else {
          throw error
        }
      }
      let data: any = {}

      if (res && res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json()
      }
      
      if (res?.ok && !data.error) {
        setLiveDetails(data)
      }

      // 2. Fetch our DB data (using google_place_id)
      const { data: prov } = await supabase
        .from('pf_providers')
        .select('*')
        .eq('google_place_id', id)
        .maybeSingle()

      let resolvedProvider = prov
        ? {
            ...prov,
            name: data.name || prov.name,
            address: data.formatted_address || prov.address,
            website: data.website || prov.website,
            phone: data.formatted_phone_number || prov.phone,
          }
        : {
            id: id,
            google_place_id: id,
            name: data.name || 'Unknown Provider',
            address: data.formatted_address || '',
            category:
              resolveProviderCategory({
                requestedCategory,
                googleTypes: data.types,
                name: data.name,
                website: data.website,
              }),
            subscription_tier: 'free',
            website: data.website || '',
            phone: data.formatted_phone_number || '',
            breeds_specialised: [],
            services: [],
            animals_served: [],
            breeds_general_inferred: [],
            has_online_booking: false,
            booking_checked_at: null,
            tagging_attempt_count: 0,
            breed_analysis_exhausted: false,
            ai_tagging_skipped_low_content: false,
            is_claimed: false,
          }

      const currentAnalysisStatus = getBreedAnalysisStatus(resolvedProvider)
      const shouldRefreshBreedCoverage = shouldRefreshIncompleteBreedCoverage(resolvedProvider)
      const shouldRetryAnalysis = shouldAutoRetryBreedAnalysis(resolvedProvider)
      const providerWebsite = data.website || resolvedProvider.website

      if (!shouldRetryAnalysis && !shouldRefreshBreedCoverage) {
        setBreedTagStatus(currentAnalysisStatus)
      } else if (providerWebsite) {
        void refreshSavedWebsiteAnalysis(id, resolvedProvider, providerWebsite, data)
      } else {
        setBreedTagStatus('no_website')
      }
      setProvider(resolvedProvider)

      if (resolvedProvider.id !== id) {
        // Fetch native pf_reviews using our internal DB ID
        const { data: revs } = await supabase
          .from('pf_reviews')
          .select('*')
          .eq('provider_id', resolvedProvider.id)
          .order('created_at', { ascending: false })

        const reviewRows = revs || []
        const reviewerIds = [...new Set(reviewRows.map((review: any) => review.user_id).filter(Boolean))]
        let reviewerMap = new Map<string, { full_name: string | null }>()

        if (reviewerIds.length > 0) {
          const { data: reviewerRows } = await supabase
            .from('pf_profiles')
            .select('id, full_name')
            .in('id', reviewerIds)

          reviewerMap = new Map((reviewerRows || []).map((row: any) => [row.id, { full_name: row.full_name }]))
        }

        setReviews(
          reviewRows.map((review: any) => ({
            ...review,
            pf_profiles: reviewerMap.get(review.user_id) || null,
          }))
        )
      } else {
        setReviews([])
      }
    } catch (error) {
      console.error(error)
      setBreedTagStatus('unavailable')
    }

    setLoading(false)
  }

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return alert('Please sign in to leave a review')

    // If the provider isn't in our DB yet, we need to create it first!
    // For simplicity in this demo, we'll alert if it's not claimed/saved in DB
    if (provider.id === id) { // means it's a temporary place_id object
      return alert('This business must be claimed before reviews can be added.')
    }

    setReviewSubmitState('saving')

    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: provider.id, // The real UUID from DB
        ...reviewForm
      })
    })

    if (res.ok) {
      setReviewSubmitState('saved')
      setShowReviewForm(false)
      setReviewForm({
        dog_breed: '',
        handling_rating: 5,
        environment_rating: 5,
        comment: '',
        temperament_tags: []
      })
      fetchData() // refresh
    } else {
      setReviewSubmitState('error')
      alert('Failed to submit review')
    }
  }

  const toggleTag = (tag: string) => {
    setReviewForm(prev => ({
      ...prev,
      temperament_tags: prev.temperament_tags.includes(tag)
        ? prev.temperament_tags.filter(t => t !== tag)
        : [...prev.temperament_tags, tag]
    }))
  }

  const handleCopyNumber = async () => {
    if (!callNumber) return

    try {
      await navigator.clipboard.writeText(callNumber)
      setShowCopiedState(true)
      window.setTimeout(() => {
        setShowCopiedState(false)
      }, 1500)
    } catch (error) {
      console.error('Failed to copy phone number', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-lg rounded-3xl border border-stone-100 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-stone-200 border-t-[#829e8d]" />
          <h2 className="mt-6 text-2xl font-bold text-stone-900">{loadingMessage}</h2>
          <p className="mt-2 text-sm text-stone-500">
            {breedTagStatus === 'generating'
              ? 'We are saving breed categories from the business website before opening the profile.'
              : breedTagStatus === 'delayed'
                ? 'We are still analysing this business. The profile will open with the latest saved data.'
              : 'Please wait while we prepare the provider details.'}
          </p>
        </div>
      </div>
    )
  }
  if (!provider) return <div className="min-h-screen bg-[#FAF9F6] p-8 text-center">Provider not found</div>

  const isPremium = provider.subscription_tier !== 'free'
  const canShowLivePreview = isPremium || isFeaturedProfile
  const visibleAiSummary = provider.review_summary
  const websiteUrl = normalizeExternalUrl(provider.website)
  const hasOnlineBooking =
    typeof provider.has_online_booking === 'boolean' ? provider.has_online_booking : Boolean(provider.booking_url)
  const bookingUrl = hasOnlineBooking ? normalizeExternalUrl(provider.booking_url) : null
  const callNumber = getDisplayPhoneNumber(provider.phone || liveDetails?.formatted_phone_number)
  const isOpenNow = liveDetails?.opening_hours?.open_now
  const availableTags = ['anxious', 'reactive', 'friendly', 'high energy', 'senior', 'rescue']

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* Header Banner */}
      <div className="bg-stone-800 h-48 relative">
        {canShowLivePreview && liveDetails?.photos?.[0] && (
          <div className="absolute inset-0 opacity-60">
            <ProviderImage
              photoReference={liveDetails.photos[0].photo_reference}
              alt={`${provider.name} cover`}
              sizes="100vw"
              priority
            />
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto -mt-24 max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm sm:p-8 md:flex-row md:gap-8">
          
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-stone-900 sm:text-4xl">{provider.name}</h1>
              {canShowLivePreview && <CheckCircle className="w-8 h-8 text-green-500" />}
            </div>
            
            <p className="text-lg text-stone-600 capitalize flex items-center gap-2 mb-4">
              {formatCategoryLabel(provider.category) || 'Uncategorised Pet Service'}
            </p>

            <div className="flex items-center gap-2 text-stone-600 mb-6">
              <MapPin className="w-5 h-5" />
              <span>{provider.address || provider.postcode}</span>
            </div>

            <div className="mb-6">
              <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${isOpenNow === true ? 'bg-green-100 text-green-700' : isOpenNow === false ? 'bg-stone-100 text-stone-600' : 'bg-stone-50 text-stone-400'}`}>
                {isOpenNow === true ? 'Open now' : isOpenNow === false ? 'Closed now' : 'Opening hours unavailable'}
              </span>
            </div>

            <div className="mb-8 flex flex-wrap gap-3">
              <div className="inline-flex items-center rounded-full bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-700">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-black shadow-sm text-stone-600">G</span>
                {liveDetails?.rating ? `${liveDetails.rating}/5` : 'N/A'}
                <span className="ml-2 text-xs font-medium text-stone-500">
                  {typeof liveDetails?.user_ratings_total === 'number' ? `(${liveDetails.user_ratings_total}) Google` : 'Google'}
                </span>
              </div>
              <div className="inline-flex items-center rounded-full bg-[#829e8d]/10 px-4 py-2 text-sm font-semibold text-[#6c8676]">
                <Star className="mr-2 h-4 w-4 fill-current" />
                {nativeRatingSummary ? `${nativeRatingSummary.score}/5` : 'No native reviews yet'}
                <span className="ml-2 text-xs font-medium text-[#6c8676]/80">
                  {nativeRatingSummary ? `(${nativeRatingSummary.count}) Verified Reviews` : 'Verified Reviews'}
                </span>
              </div>
            </div>

            {/* User Review Summary */}
            {visibleAiSummary && (
              <div className="rounded-2xl border border-[#e7d7a6] bg-[#fffaf0] p-6 mb-8 shadow-sm">
                <div className="mb-3 inline-flex items-center rounded-full bg-[#f6edd1] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#8a6d1f]">
                  User Review Summary
                </div>
                <div className="mt-1 flex items-center gap-2 text-[#6c8676] font-semibold">
                  <ShieldCheck className="w-5 h-5" />
                  Based on verified reviews from PawFinder users
                </div>
                <p className="mt-3 text-stone-700 leading-7">{visibleAiSummary}</p>
              </div>
            )}

            <div className="mb-8 grid gap-4 md:grid-cols-2 md:gap-6">
              <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">Service Categories</h3>
                <div className="mt-3">
                  {isAnalysisPending ? (
                    <div className="rounded-2xl border border-dashed border-stone-200 bg-white/70 px-4 py-5">
                      <div className="flex items-center gap-3">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-200 border-t-[#829e8d]" />
                        <div className="text-sm font-medium text-stone-700">{analysisLoadingLabel}</div>
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="h-4 w-28 animate-pulse rounded-full bg-stone-200/80" />
                        <div className="flex flex-wrap gap-2">
                          <div className="h-8 w-24 animate-pulse rounded-full bg-[#829e8d]/10" />
                          <div className="h-8 w-20 animate-pulse rounded-full bg-[#829e8d]/10" />
                        </div>
                      </div>
                    </div>
                  ) : displayedServiceCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {displayedServiceCategories.map((service) => (
                        <span key={service} className="rounded-full bg-[#829e8d]/10 px-3 py-1.5 text-sm font-medium text-[#6c8676]">
                          {service}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-stone-200 bg-white/70 px-4 py-5">
                      <div className="text-sm font-medium text-stone-600">
                        Service categories could not be confirmed from the business website yet.
                      </div>
                      <p className="mt-1 text-xs leading-5 text-stone-400">
                        We only show saved service categories after website analysis has finished.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">Breeds Supported</h3>
                <div className="mt-3 space-y-4">
                  {isAnalysisPending ? (
                    <div className="rounded-2xl border border-dashed border-stone-200 bg-white/70 px-4 py-5">
                      <div className="flex items-center gap-3">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-200 border-t-[#829e8d]" />
                        <div className="text-sm font-medium text-stone-700">{analysisLoadingLabel}</div>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-stone-400">
                        Breed and animal coverage will appear here once the current analysis finishes.
                      </p>
                      <div className="mt-4 space-y-3">
                        <div className="h-4 w-32 animate-pulse rounded-full bg-stone-200/80" />
                        <div className="flex flex-wrap gap-2">
                          <div className="h-8 w-28 animate-pulse rounded-full bg-stone-200/80" />
                          <div className="h-8 w-24 animate-pulse rounded-full bg-stone-200/80" />
                          <div className="h-8 w-20 animate-pulse rounded-full bg-stone-200/80" />
                        </div>
                      </div>
                    </div>
                  ) : displayedBreedValues.length > 0 ||
                  generalCoverageLabels.length > 0 ||
                  supportedAnimalLabels.length > 0 ? (
                    <div className="space-y-4">
                      {displayedBreedValues.length > 0 &&
                        (Object.entries(groupedBreeds) as Array<[string, string[]]>).map(([animal, breeds]) => (
                          <div key={animal}>
                            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                              {animal === 'other' ? 'Specialised coverage' : `${animal} specialisms`}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {breeds.map((breed) => (
                                <span
                                  key={breed}
                                  className="rounded-full bg-[#e07a5f]/10 px-3 py-1.5 text-sm font-medium text-[#c26046]"
                                >
                                  {getBreedLabel(breed)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}

                      {generalCoverageLabels.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                            General coverage inferred
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {generalCoverageLabels.map((label: string) => (
                              <span
                                key={label}
                                className="rounded-full bg-stone-100 px-3 py-1.5 text-sm font-medium text-stone-600"
                              >
                                Generally treats: {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {supportedAnimalLabels.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                            Animals confirmed
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {supportedAnimalLabels.map((label: string) => (
                              <span
                                key={label}
                                className="rounded-full bg-[#829e8d]/10 px-3 py-1.5 text-sm font-medium text-[#6c8676]"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-stone-200 bg-white/70 px-4 py-5">
                      <div className="text-sm font-medium text-stone-600">
                        {getBreedStatusMessage(breedTagStatus)}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-stone-400">
                        We only show breed categories after they have been saved to the database from website analysis.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
              {callNumber && (
                <button onClick={() => setShowCallPopup(true)} className="rounded-full bg-[#829e8d] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#6c8676]">
                  Call Business
                </button>
              )}
              {websiteUrl && (
                <a href={websiteUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#e07a5f] px-6 py-3 text-center font-semibold text-white transition-colors hover:bg-[#d06950]">
                  Visit Website
                </a>
              )}
              {bookingUrl && (
                <a href={bookingUrl} target="_blank" rel="noreferrer" className="rounded-full bg-stone-800 px-6 py-3 text-center font-semibold text-white transition-colors hover:bg-stone-700">
                  Book Online
                </a>
              )}
            </div>
          </div>

          {/* Premium Live Google Data */}
          {canShowLivePreview ? (
            <div className="w-full rounded-xl border border-stone-100 bg-stone-50 p-5 sm:p-6 md:w-72">
              {/* FIX 4: Clear Google Rating Distinction */}
              <h3 className="font-bold text-stone-800 mb-4 flex items-center gap-2">
                <span className="bg-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shadow-sm text-stone-600">G</span>
                Google Rating
              </h3>
              <div className="text-4xl font-black text-stone-900 mb-2">{liveDetails?.rating || 'N/A'}</div>
              <p className="text-sm text-stone-500 mb-6">Live from Google Places</p>
              
              {liveDetails?.photos && (
                <div className="grid grid-cols-2 gap-2">
                  {liveDetails.photos.slice(1, 5).map((photo: any, i: number) => (
                    <div key={i} className="relative h-24 overflow-hidden rounded-lg sm:h-28 md:h-24">
                      <ProviderImage
                        photoReference={photo.photo_reference}
                        alt={`${provider.name} gallery ${i + 1}`}
                        sizes="(max-width: 768px) 50vw, 144px"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex w-full flex-col items-center justify-center rounded-xl border border-stone-200 bg-stone-50 p-5 text-center sm:p-6 md:w-72">
              <Info className="w-12 h-12 text-stone-400 mb-4" />
              <h3 className="font-bold text-stone-800 mb-2">Unverified Profile</h3>
              <p className="text-sm text-stone-500 mb-4">This business hasn't verified their profile or uploaded photos yet.</p>
              <Link href={`/business/dashboard?claim=${encodeURIComponent(provider.google_place_id || provider.id)}`} className="text-[#829e8d] font-semibold text-sm hover:underline">
                Are you the owner? Claim this listing
              </Link>
            </div>
          )}
        </div>

        {isFeaturedProfile && liveDetails?.reviews?.length > 0 && (
          <div className="mt-8 rounded-2xl border border-stone-100 bg-white p-5 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold text-stone-900">Google Review Preview</h2>
            <p className="mt-1 text-sm text-stone-500">Showing up to 5 live Google reviews for the nearest result you opened from search.</p>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {liveDetails.reviews.slice(0, 5).map((review: any, index: number) => (
                <div key={`${review.author_name || 'review'}-${index}`} className="rounded-2xl border border-stone-100 bg-stone-50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-semibold text-stone-800">{review.author_name || 'Google review'}</span>
                      <div className="mt-1 text-xs uppercase tracking-wide text-stone-400">{review.relative_time_description || 'Recent'}</div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-stone-700 shadow-sm">
                      {review.rating ? `${review.rating}/5` : 'No score'}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-stone-600">{review.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Native Reviews Section */}
        <div className="mt-12">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-bold text-stone-900 flex items-center gap-3">
                Temperament Reviews
                <span className="bg-[#829e8d] text-white text-xs px-2 py-1 rounded-full uppercase tracking-wider font-bold">Native</span>
              </h2>
              <p className="text-stone-500 mt-1">Verified handling and environment ratings from real pet owners.</p>
              {pf_reviews.length > 0 && <p className="mt-2 text-sm text-stone-400">{pf_reviews.length} review{pf_reviews.length === 1 ? '' : 's'}</p>}
            </div>
            <button 
              onClick={() => setShowReviewForm(!showReviewForm)}
              className="w-full rounded-full border border-stone-300 bg-white px-6 py-2.5 font-semibold text-stone-700 transition-colors hover:bg-stone-50 sm:w-auto"
            >
              Leave a Review
            </button>
          </div>

          {showReviewForm && (
            <div className="mb-8 rounded-2xl border border-[#829e8d] bg-white p-5 shadow-sm sm:p-8">
              <h3 className="text-xl font-bold mb-6">Write a Temperament Review</h3>
              <form onSubmit={submitReview} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-2">Pet Breed (e.g. Rescue Greyhound)</label>
                  <input required type="text" value={reviewForm.dog_breed} onChange={e => setReviewForm({...reviewForm, dog_breed: e.target.value})} className="w-full rounded-md border border-stone-300 px-3 py-2" />
                </div>
                
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">Handling Rating (1-5)</label>
                    <input type="number" min="1" max="5" value={reviewForm.handling_rating} onChange={e => setReviewForm({...reviewForm, handling_rating: parseInt(e.target.value)})} className="w-full rounded-md border border-stone-300 px-3 py-2" />
                    <p className="text-xs text-stone-500 mt-1">How well did they handle your pet's specific needs?</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-2">Environment Rating (1-5)</label>
                    <input type="number" min="1" max="5" value={reviewForm.environment_rating} onChange={e => setReviewForm({...reviewForm, environment_rating: parseInt(e.target.value)})} className="w-full rounded-md border border-stone-300 px-3 py-2" />
                    <p className="text-xs text-stone-500 mt-1">Was the environment calm, chaotic, secure?</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-2">Temperament Tags</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map(tag => (
                      <button 
                        key={tag} 
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${reviewForm.temperament_tags.includes(tag) ? 'bg-[#829e8d] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-2">Comment</label>
                  <textarea required rows={4} value={reviewForm.comment} onChange={e => setReviewForm({...reviewForm, comment: e.target.value})} className="w-full rounded-md border border-stone-300 px-3 py-2"></textarea>
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:gap-4">
                  <button type="button" onClick={() => setShowReviewForm(false)} className="rounded-full px-6 py-2.5 font-medium text-stone-600 hover:bg-stone-100">Cancel</button>
                  <button type="submit" className="rounded-full bg-[#829e8d] px-6 py-2.5 font-semibold text-white hover:bg-[#6c8676]">Submit Review</button>
                </div>
              </form>
            </div>
          )}

          {reviewSubmitState === 'saving' && (
            <div className="mb-6 rounded-2xl border border-[#829e8d]/20 bg-[#829e8d]/10 px-4 py-3 text-sm font-medium text-[#6c8676]">
              Saving your review and refreshing the AI summary...
            </div>
          )}

          {reviewSubmitState === 'saved' && (
            <div className="mb-6 rounded-2xl border border-[#829e8d]/20 bg-[#829e8d]/10 px-4 py-3 text-sm font-medium text-[#6c8676]">
              Review saved. The AI summary refresh runs in the background and may take a short while to appear.
            </div>
          )}

          <div>
            {pf_reviews.length === 0 ? (
              <div className="rounded-2xl border border-stone-100 bg-stone-50 p-8 text-center sm:p-12">
                <Star className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-stone-800 mb-2">No temperament reviews yet</h3>
                <p className="text-stone-500 mb-6">Be the first to leave a breed-specific review for this business!</p>
                <button 
                  onClick={() => setShowReviewForm(true)}
                  className="bg-[#829e8d] text-white px-6 py-2 rounded-full font-semibold hover:bg-[#6c8676] transition-colors"
                >
                  Write the first review
                </button>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {pf_reviews.map((review) => {
                  const reviewerName = review.pf_profiles?.full_name || 'Anonymous User'
                  const averageScore = getReviewAverage(review)

                  return (
                    <article key={review.id} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#829e8d]/10 text-sm font-bold text-[#6c8676]">
                            {getReviewerInitials(reviewerName)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-bold text-stone-900">{reviewerName}</div>
                            <div className="mt-1 text-sm text-stone-500">
                              Pet breed: <span className="font-medium text-stone-700">{review.dog_breed}</span>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-full bg-[#829e8d]/10 px-3 py-1 text-sm font-semibold text-[#6c8676] whitespace-nowrap">
                          {averageScore}/5
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-stone-400">
                        <span>{new Date(review.created_at).toLocaleDateString()}</span>
                        <span className="hidden h-1 w-1 rounded-full bg-stone-300 sm:block" />
                        <span>{review.temperament_tags?.length || 0} temperament tags</span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-stone-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Handling</div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-base font-bold text-stone-900">{review.handling_rating}/5</span>
                            <div className="flex text-[#e07a5f]">
                              {[...Array(5)].map((_, i) => (
                                <Star key={i} className={`h-3.5 w-3.5 ${i < review.handling_rating ? 'fill-current' : 'text-stone-300'}`} />
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="rounded-xl bg-stone-50 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Environment</div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-base font-bold text-stone-900">{review.environment_rating}/5</span>
                            <div className="flex text-[#e07a5f]">
                              {[...Array(5)].map((_, i) => (
                                <Star key={i} className={`h-3.5 w-3.5 ${i < review.environment_rating ? 'fill-current' : 'text-stone-300'}`} />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50/70 p-4">
                        <p className="text-sm leading-6 text-stone-700">{review.comment}</p>
                      </div>

                      {review.temperament_tags?.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {review.temperament_tags.map((tag: string) => (
                            <span key={tag} className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-stone-600">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCallPopup && callNumber && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/45 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <h3 className="text-lg font-bold text-stone-900">Business Phone Number</h3>
            <div className="mt-3 flex items-center justify-center gap-3">
              <p className="text-2xl font-semibold tracking-wide text-[#6c8676]">{callNumber}</p>
              <button
                type="button"
                onClick={handleCopyNumber}
                className="rounded-full bg-stone-100 p-2 text-stone-600 transition-colors hover:bg-stone-200"
                aria-label="Copy phone number"
              >
                {showCopiedState ? <Check className="h-5 w-5 text-[#6c8676]" /> : <Copy className="h-5 w-5" />}
              </button>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              {showCopiedState ? 'Copied' : 'Tap the icon to copy the number.'}
            </p>
            <button
              onClick={() => setShowCallPopup(false)}
              className="mt-5 w-full rounded-full bg-stone-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
