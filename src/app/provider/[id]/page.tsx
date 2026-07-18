'use client'

import Image from 'next/image'
import { useState, useEffect, use, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Star, MapPin, CheckCircle, ShieldCheck, Copy, Check, Info } from 'lucide-react'
import { BREED_OPTIONS } from '@/lib/breed-taxonomy'
import { ProviderImage } from '@/components/ProviderImage'
import ActionTriggerToast, {
  type ProviderContactActionType,
} from '@/components/provider/ActionTriggerToast'
import { resolveProviderCategory } from '@/lib/provider-category'
import {
  type BreedAnalysisStatus,
  getBreedAnalysisStatus,
  hasAnalysisAttemptsRemaining,
  hasMeaningfulBreedAnalysis,
  shouldAttemptPhotoBreedSupplement,
  shouldAutoRetryBreedAnalysis,
  shouldRefreshIncompleteBreedCoverage,
} from '@/lib/provider-analysis-state'
import {
  inferServicesFromBusinessName,
  removeCategoryDuplicateServices,
} from '@/lib/provider-name-service-inference'
import { getProviderSessionCache, primeProviderSessionCache } from '@/lib/provider-session-cache'

type ProviderProfileRecord = {
  id: string
  google_place_id: string
  name: string
  address: string
  postcode?: string | null
  category?: string | null
  subscription_tier?: string | null
  website?: string | null
  phone?: string | null
  breeds_specialised?: string[] | null
  services?: string[] | null
  services_inferred_from_name?: string[] | null
  animals_served?: string[] | null
  breeds_general_inferred?: string[] | null
  has_online_booking?: boolean | null
  booking_url?: string | null
  booking_checked_at?: string | null
  tagging_attempt_count?: number | null
  breed_analysis_exhausted?: boolean | null
  photo_tagging_attempt_count?: number | null
  photo_breed_analysis_exhausted?: boolean | null
  ai_tagged_at?: string | null
  ai_tagging_skipped_low_content?: boolean | null
  is_claimed?: boolean | null
  is_verified?: boolean | null
  review_summary?: string | null
  photo_reference?: string | null
  [key: string]: unknown
}

type NativeReview = {
  id: string
  user_id?: string | null
  handling_rating?: number | null
  environment_rating?: number | null
  dog_breed?: string | null
  temperament_tags?: string[]
  comment?: string | null
  created_at: string
  pf_profiles?: { full_name: string | null } | null
}

type LivePhoto = {
  photo_reference?: string
  [key: string]: unknown
}

type LiveReview = {
  author_name?: string
  rating?: number | null
  text?: string
  relative_time_description?: string
  [key: string]: unknown
}

type LiveDetailsRecord = {
  place_id?: string
  name?: string
  formatted_address?: string
  formatted_phone_number?: string
  website?: string
  types?: string[]
  photos?: LivePhoto[]
  reviews?: LiveReview[]
  rating?: number | null
  user_ratings_total?: number | null
  opening_hours?: {
    open_now?: boolean
    [key: string]: unknown
  } | null
  ai_summary?: string | null
  error?: unknown
  [key: string]: unknown
}

type EnsureTagsResponse = {
  provider?: ProviderProfileRecord
  analysis_status?: BreedAnalysisStatus | 'category_unresolved'
  error?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GOOGLE_PLACE_ID_PATTERN = /^ChI[A-Za-z0-9_-]{10,}$/

function isUuidLike(value: string) {
  return UUID_PATTERN.test(value.trim())
}

function hasItems(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

function looksLikeGooglePlaceId(value: string | null | undefined) {
  if (typeof value !== 'string') return false
  return GOOGLE_PLACE_ID_PATTERN.test(value.trim())
}

type ProviderPageBreedStatus =
  | BreedAnalysisStatus
  | 'idle'
  | 'loading'
  | 'generating'
  | 'delayed'
  | 'category_unresolved'

export default function ProviderProfile({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const id = resolvedParams.id
  const searchParams = useSearchParams()
  const isFeaturedProfile = searchParams.get('featured') === '1'
  const requestedCategory = searchParams.get('category')
  
  const supabase = useMemo(() => createClient(), [])
  const [provider, setProvider] = useState<ProviderProfileRecord | null>(null)
  const [pf_reviews, setReviews] = useState<NativeReview[]>([])
  const [liveDetails, setLiveDetails] = useState<LiveDetailsRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('Loading profile...')
  const [breedTagStatus, setBreedTagStatus] = useState<ProviderPageBreedStatus>('idle')
  const [user, setUser] = useState<unknown>(null)
  const [showCallPopup, setShowCallPopup] = useState(false)
  const [showCopiedState, setShowCopiedState] = useState(false)
  const [reviewSubmitState, setReviewSubmitState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [shouldShowActionToast, setShouldShowActionToast] = useState(false)
  const [activeContactAction, setActiveContactAction] = useState<ProviderContactActionType | null>(null)
  const [showGalleryInfo, setShowGalleryInfo] = useState(false)
  const actionToastTimerRef = useRef<number | null>(null)

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

  const getReviewAverage = (review: NativeReview) =>
    Number((((review.handling_rating || 0) + (review.environment_rating || 0)) / 2).toFixed(1))

  const getReviewerInitials = (name: string | null | undefined) =>
    (name || 'Anonymous User')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')

  const renderFilledStars = (
    rating: number | null | undefined,
    {
      sizeClassName = 'h-4 w-4',
      filledClassName = 'fill-amber-400 text-amber-400',
      emptyClassName = 'text-[#D9C8A6]',
    }: {
      sizeClassName?: string
      filledClassName?: string
      emptyClassName?: string
    } = {}
  ) => {
    const safeRating = typeof rating === 'number' && Number.isFinite(rating) ? rating : 0
    const filledStars = Math.max(0, Math.min(5, Math.round(safeRating)))

    return (
      <div className="flex items-center gap-1" aria-label={`${filledStars} out of 5 stars`}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Star
            key={`star-${filledStars}-${index}`}
            className={`${sizeClassName} ${index < filledStars ? filledClassName : emptyClassName}`}
          />
        ))}
      </div>
    )
  }

  const breedLabelMap = new Map<string, string>(BREED_OPTIONS.map((breed) => [breed.value, breed.label]))
  const getBreedLabel = (value: string) => breedLabelMap.get(value) || formatServiceLabel(value)
  const displayedBreedValues = Array.isArray(provider?.breeds_specialised) ? provider.breeds_specialised : []
  const generalCoverageAnimals = Array.isArray(provider?.breeds_general_inferred) ? provider.breeds_general_inferred : []
  const supportedAnimals = Array.isArray(provider?.animals_served) ? provider.animals_served : []
  const generalCoverageLabels = generalCoverageAnimals.map((animal: string) =>
    animal === 'dog' ? 'Dogs' : animal === 'cat' ? 'Cats' : animal === 'rabbit' ? 'Rabbits' : animal
  )
  const supportedAnimalLabels = supportedAnimals.map((animal: string) =>
    animal === 'dog' ? 'Dogs' : animal === 'cat' ? 'Cats' : animal === 'rabbit' ? 'Rabbits' : animal
  )
  const showNoSpecificBreedNote =
    displayedBreedValues.length === 0 &&
    generalCoverageLabels.length > 0 &&
    Boolean(provider?.photo_breed_analysis_exhausted)
  const visibleConfirmedServiceValues = removeCategoryDuplicateServices({
    category: provider?.category,
    services: provider?.services,
  })
  const visibleConfirmedServiceLabels = visibleConfirmedServiceValues.map(formatServiceLabel)
  const savedOrDerivedInferredServiceValues =
    Array.isArray(provider?.services_inferred_from_name) && provider.services_inferred_from_name.length > 0
      ? provider.services_inferred_from_name
      : inferServicesFromBusinessName({
          name: provider?.name,
          category: provider?.category,
          confirmedServices: visibleConfirmedServiceValues,
        })
  const visibleInferredServiceValues = removeCategoryDuplicateServices({
    category: provider?.category,
    services: savedOrDerivedInferredServiceValues,
  }).filter((service) => !visibleConfirmedServiceValues.includes(service))
  const visibleInferredServiceLabels = visibleInferredServiceValues.map(formatServiceLabel)
  const isAnalysisPending = breedTagStatus === 'loading' || breedTagStatus === 'generating'
  const analysisLoadingLabel =
    breedTagStatus === 'generating' ? 'Analysing this business...' : 'Checking saved profile details...'

  const syncProviderSessionCache = ({
    placeId,
    providerSnapshot,
    liveDetailsSnapshot,
    reviewsSnapshot,
  }: {
    placeId: string
    providerSnapshot?: ProviderProfileRecord
    liveDetailsSnapshot?: LiveDetailsRecord
    reviewsSnapshot?: NativeReview[]
  }) => {
    primeProviderSessionCache(placeId, {
      providerSnapshot,
      liveDetails: liveDetailsSnapshot,
      reviewsSnapshot,
    })
  }

  const refreshSavedProviderAnalysis = useCallback(async (
    placeId: string,
    baseProvider: ProviderProfileRecord,
    website: string | null | undefined,
    liveData: LiveDetailsRecord
  ) => {
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
          website: website || '',
          phone: liveData.formatted_phone_number || baseProvider.phone,
          live_place_details: {
            place_id: liveData.place_id || placeId,
            name: liveData.name || baseProvider.name,
            formatted_address: liveData.formatted_address || baseProvider.address,
            formatted_phone_number: liveData.formatted_phone_number || baseProvider.phone,
            website: liveData.website || website || '',
            types: liveData.types || [],
            photos: Array.isArray(liveData.photos) ? liveData.photos : [],
          },
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (ensureTagsRes.ok && ensureTagsRes.headers.get('content-type')?.includes('application/json')) {
        const ensureTagsData = (await ensureTagsRes.json()) as EnsureTagsResponse
        if (ensureTagsData.provider) {
          const ensuredProvider = ensureTagsData.provider
          const mergedProvider = {
            ...ensuredProvider,
            name: liveData.name || ensuredProvider.name,
            address: liveData.formatted_address || ensuredProvider.address,
            website: liveData.website || ensuredProvider.website,
            phone: liveData.formatted_phone_number || ensuredProvider.phone,
          }

          setProvider((currentProvider) =>
            currentProvider?.google_place_id === placeId ? { ...currentProvider, ...mergedProvider } : mergedProvider
          )
          syncProviderSessionCache({
            placeId,
            providerSnapshot: mergedProvider,
            liveDetailsSnapshot: liveData,
          })

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
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        console.warn('[provider-page] ensure-tags timed out', { id: placeId })
        setBreedTagStatus('delayed')
        return
      }

      console.error('[provider-page] ensure-tags failed', error)
      setBreedTagStatus('unavailable')
    }
  }, [])

  const fetchData = useCallback(async () => {
    const cachedProfile = getProviderSessionCache(id)
    const cachedProvider = (cachedProfile?.providerSnapshot as ProviderProfileRecord | undefined) || null
    const cachedLiveDetails = (cachedProfile?.liveDetails as LiveDetailsRecord | undefined) || null
    const cachedReviews = (cachedProfile?.reviewsSnapshot as NativeReview[] | undefined) || null
    const hasRenderableCachedProfile = Boolean(cachedProvider)

    if (hasRenderableCachedProfile) {
      if (cachedProvider) {
        setProvider(cachedProvider)
        setBreedTagStatus(getBreedAnalysisStatus(cachedProvider))
      } else {
        setBreedTagStatus('loading')
      }

      if (cachedLiveDetails) {
        setLiveDetails(cachedLiveDetails)
      }

      if (cachedReviews) {
        setReviews(cachedReviews)
      }

      setLoading(false)
      setLoadingMessage('Refreshing profile...')
    } else {
      setLoading(true)
      setLoadingMessage('Loading profile...')
      setBreedTagStatus('loading')
    }

    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setUser(user)
      })
      .catch((error) => {
        console.error('Failed to load current user for provider page', error)
      })

    // Resolve either an internal provider UUID or a Google Place ID, then
    // rehydrate live details only when the cached profile is still missing them.
    try {
      let dbProvider: ProviderProfileRecord | null = null

      if (isUuidLike(id)) {
        const { data: providerByInternalId } = await supabase
          .from('pf_providers')
          .select('*')
          .eq('id', id)
          .maybeSingle()

        dbProvider = (providerByInternalId as ProviderProfileRecord | null) || null
      }

      if (!dbProvider) {
        const { data: providerByPlaceId } = await supabase
          .from('pf_providers')
          .select('*')
          .eq('google_place_id', id)
          .maybeSingle()

        dbProvider = (providerByPlaceId as ProviderProfileRecord | null) || null
      }

      const canonicalPlaceId = dbProvider?.google_place_id || id
      const canFetchLiveDetails = Boolean(
        (dbProvider?.google_place_id && looksLikeGooglePlaceId(dbProvider.google_place_id)) ||
          looksLikeGooglePlaceId(canonicalPlaceId)
      )
      const canonicalCachedProfile = (
        getProviderSessionCache(canonicalPlaceId)?.providerSnapshot as ProviderProfileRecord | undefined
      ) || cachedProvider
      const canonicalCachedLiveDetails = (
        getProviderSessionCache(canonicalPlaceId)?.liveDetails as LiveDetailsRecord | undefined
      ) || cachedLiveDetails
      const canonicalCachedReviews = (
        getProviderSessionCache(canonicalPlaceId)?.reviewsSnapshot as NativeReview[] | undefined
      ) || cachedReviews

      if (canonicalCachedProfile) {
        setProvider(canonicalCachedProfile)
        setBreedTagStatus(getBreedAnalysisStatus(canonicalCachedProfile))
      }

      if (canonicalCachedLiveDetails) {
        setLiveDetails(canonicalCachedLiveDetails)
      }

      if (canonicalCachedReviews) {
        setReviews(canonicalCachedReviews)
      }

      let data: LiveDetailsRecord = canonicalCachedLiveDetails ? { ...canonicalCachedLiveDetails } : {}
      const shouldHydrateLiveDetails =
        !canonicalCachedLiveDetails ||
        !hasItems(canonicalCachedLiveDetails.photos) ||
        !hasItems(canonicalCachedLiveDetails.reviews)

      if (shouldHydrateLiveDetails && canFetchLiveDetails) {
        const detailsUrl = `/api/providers/${encodeURIComponent(canonicalPlaceId)}/live-details?include_ai_summary=1`
        let res: Response | null = null
        try {
          res = await fetch(detailsUrl, { signal: AbortSignal.timeout(15000) })
        } catch (error: unknown) {
          if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
            console.warn('[provider-page] live details timed out', { id, detailsUrl })
          } else {
            throw error
          }
        }

        if (res && res.headers.get('content-type')?.includes('application/json')) {
          data = await res.json()
        }

        if (res?.ok && !data.error) {
          setLiveDetails(data)
          syncProviderSessionCache({
            placeId: data.place_id || canonicalPlaceId,
            liveDetailsSnapshot: data,
          })
        }
      } else if (shouldHydrateLiveDetails && !canFetchLiveDetails) {
        console.warn('[provider-page] skipped live-details fetch for unresolved route parameter', {
          id,
          canonicalPlaceId,
        })
      }

      // 2. Fetch our DB data (using google_place_id)
      const resolvedProvider: ProviderProfileRecord = dbProvider
        ? {
            ...dbProvider,
            google_place_id: data.place_id || canonicalPlaceId,
            name: data.name || dbProvider.name,
            address: data.formatted_address || dbProvider.address,
            website: data.website || dbProvider.website,
            phone: data.formatted_phone_number || dbProvider.phone,
            photo_reference:
              (typeof cachedProvider?.photo_reference === 'string' && cachedProvider.photo_reference) ||
              data.photos?.[0]?.photo_reference ||
              null,
          }
        : {
            id,
            google_place_id: data.place_id || canonicalPlaceId,
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
            photo_tagging_attempt_count: 0,
            photo_breed_analysis_exhausted: false,
            ai_tagging_skipped_low_content: false,
            is_claimed: false,
            photo_reference:
              (typeof cachedProvider?.photo_reference === 'string' && cachedProvider.photo_reference) ||
              data.photos?.[0]?.photo_reference ||
              null,
          }

      const currentAnalysisStatus = getBreedAnalysisStatus(resolvedProvider)
      const shouldRefreshBreedCoverage = shouldRefreshIncompleteBreedCoverage(resolvedProvider)
      const shouldRetryAnalysis = shouldAutoRetryBreedAnalysis(resolvedProvider)
      const providerWebsite = data.website || resolvedProvider.website
      const shouldAnalyzeFreshWebsite = Boolean(data.website && !resolvedProvider.website)
      const hasGooglePhotos = Array.isArray(data.photos) && data.photos.length > 0
      const shouldRetryPhotoAnalysis =
        !providerWebsite &&
        hasGooglePhotos &&
        !hasMeaningfulBreedAnalysis(resolvedProvider) &&
        hasAnalysisAttemptsRemaining(resolvedProvider)
      const shouldSupplementPhotoBreeds =
        Boolean(providerWebsite) &&
        hasGooglePhotos &&
        shouldAttemptPhotoBreedSupplement(resolvedProvider)

      if (
        !shouldRetryAnalysis &&
        !shouldRefreshBreedCoverage &&
        !shouldRetryPhotoAnalysis &&
        !shouldAnalyzeFreshWebsite &&
        !shouldSupplementPhotoBreeds
      ) {
        setBreedTagStatus(currentAnalysisStatus)
      } else if (providerWebsite) {
        void refreshSavedProviderAnalysis(
          resolvedProvider.google_place_id || canonicalPlaceId,
          resolvedProvider,
          providerWebsite,
          data
        )
      } else if (shouldRetryPhotoAnalysis) {
        void refreshSavedProviderAnalysis(
          resolvedProvider.google_place_id || canonicalPlaceId,
          resolvedProvider,
          null,
          data
        )
      } else {
        setBreedTagStatus(currentAnalysisStatus)
      }
      setProvider(resolvedProvider)
      syncProviderSessionCache({
        placeId: resolvedProvider.google_place_id || canonicalPlaceId,
        providerSnapshot: resolvedProvider,
        liveDetailsSnapshot: !data.error ? data : canonicalCachedLiveDetails || undefined,
      })

      let resolvedReviews: NativeReview[] = []
      if (dbProvider?.id) {
        // Fetch native pf_reviews using the canonical internal DB ID
        const { data: revs } = await supabase
          .from('pf_reviews')
          .select('*')
          .eq('provider_id', dbProvider.id)
          .order('created_at', { ascending: false })

        const reviewRows = (revs || []) as NativeReview[]
        const reviewerIds = [...new Set(reviewRows.map((review) => review.user_id).filter(Boolean))]
        let reviewerMap = new Map<string, { full_name: string | null }>()

        if (reviewerIds.length > 0) {
          const { data: reviewerRows } = await supabase
            .from('pf_profiles')
            .select('id, full_name')
            .in('id', reviewerIds)

          reviewerMap = new Map(
            ((reviewerRows || []) as Array<{ id: string; full_name: string | null }>).map((row) => [
              row.id,
              { full_name: row.full_name },
            ])
          )
        }

        resolvedReviews = reviewRows.map((review) => ({
          ...review,
          pf_profiles: review.user_id ? reviewerMap.get(review.user_id) || null : null,
        }))
        setReviews(resolvedReviews)
      } else {
        setReviews([])
      }

      syncProviderSessionCache({
        placeId: resolvedProvider.google_place_id || canonicalPlaceId,
        providerSnapshot: resolvedProvider,
        liveDetailsSnapshot: !data.error ? data : canonicalCachedLiveDetails || undefined,
        reviewsSnapshot: dbProvider?.id ? resolvedReviews : [],
      })
    } catch (error) {
      console.error(error)
      setBreedTagStatus('unavailable')
    }

    setLoading(false)
  }, [id, requestedCategory, supabase, refreshSavedProviderAnalysis])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchData()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fetchData])

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return alert('Please sign in to leave a review')
    if (!provider) return alert('Provider details are still loading.')

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
      void fetchData() // refresh
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

  const actionToastSessionKey = `pawfinder:action-trigger-toast:${id}`

  const closeActionToast = useCallback(() => {
    if (actionToastTimerRef.current) {
      window.clearTimeout(actionToastTimerRef.current)
      actionToastTimerRef.current = null
    }

    setShouldShowActionToast(false)
    setActiveContactAction(null)
  }, [])

  const handleContactAction = useCallback((actionType: ProviderContactActionType) => {
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(actionToastSessionKey)) return

    window.sessionStorage.setItem(actionToastSessionKey, '1')
    setActiveContactAction(actionType)

    if (actionToastTimerRef.current) {
      window.clearTimeout(actionToastTimerRef.current)
    }

    actionToastTimerRef.current = window.setTimeout(() => {
      setShouldShowActionToast(true)
      actionToastTimerRef.current = null
    }, 3000)
  }, [actionToastSessionKey])

  useEffect(() => {
    return () => {
      if (actionToastTimerRef.current) {
        window.clearTimeout(actionToastTimerRef.current)
      }
    }
  }, [])

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

  const isVerifiedBusiness =
    provider.is_verified || provider.subscription_tier === 'verified' || provider.subscription_tier === 'premium'
  const visibleAiSummary = provider.review_summary || liveDetails?.ai_summary || null
  const visibleAiSummarySourceLabel = provider.review_summary
    ? 'Based on verified PawFinder reviews'
    : liveDetails?.ai_summary
      ? 'Based on recent Google customer reviews'
      : null
  const visibleAiSummaryAccentClass = provider.review_summary
    ? 'bg-[#3D5A45]/12 text-[#3D5A45]'
    : 'bg-[#F3E3B7] text-[#7A5A19]'
  const websiteUrl = normalizeExternalUrl(provider.website)
  const hasOnlineBooking =
    typeof provider.has_online_booking === 'boolean' ? provider.has_online_booking : Boolean(provider.booking_url)
  const bookingUrl = hasOnlineBooking ? normalizeExternalUrl(provider.booking_url) : null
  const callNumber = getDisplayPhoneNumber(provider.phone || liveDetails?.formatted_phone_number)
  const isOpenNow = liveDetails?.opening_hours?.open_now
  const livePhotos = liveDetails?.photos ?? []
  const primaryPhotoReference =
    (typeof provider.photo_reference === 'string' && provider.photo_reference) ||
    livePhotos[0]?.photo_reference ||
    null
  const liveReviews = liveDetails?.reviews ?? []
  const availableTags = ['anxious', 'reactive', 'friendly', 'high energy', 'senior', 'rescue']
  const categoryLabel = formatCategoryLabel(provider.category) || 'Uncategorised Pet Service'
  const locationLabel = provider.address || provider.postcode || 'Address unavailable'
  const consolidatedBreedBadges = Array.from(
    new Map(
      [
        ...displayedBreedValues.map((breed) => getBreedLabel(breed)),
        ...generalCoverageLabels,
        ...supportedAnimalLabels,
      ]
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => [label.toLowerCase(), label])
    ).values()
  )
  const directionsQuery = encodeURIComponent(`${provider.name} ${locationLabel}`)
  const directionsUrl = provider.google_place_id
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(provider.google_place_id)}&query=${directionsQuery}`
    : `https://www.google.com/maps/search/?api=1&query=${directionsQuery}`
  const lockedGallerySlots = Array.from({ length: 4 }, (_, index) => index)
  const showTemperamentReviews = false

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#2F312E]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top_left,_rgba(201,162,75,0.18),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(61,90,69,0.2),_transparent_38%),linear-gradient(180deg,_#5A6E5B_0%,_#435448_38%,_#FAF6F0_100%)]" />
        <div className="absolute left-6 top-28 h-40 w-40 rounded-full bg-[#F0E1BD]/35 blur-3xl" />
        <div className="absolute right-[-3rem] top-10 h-56 w-56 rounded-full bg-[#A3B39A]/25 blur-3xl" />

        <div className="relative h-56 overflow-hidden sm:h-72">
          {primaryPhotoReference ? (
            <>
              <div className="absolute inset-0">
                <ProviderImage
                  photoReference={primaryPhotoReference}
                  alt={`${provider.name} cover`}
                  sizes="100vw"
                  priority
                />
              </div>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(33,44,37,0.2)_0%,rgba(33,44,37,0.42)_42%,rgba(33,44,37,0.82)_100%)]" />
            </>
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(180deg,#6D7E6E_0%,#4C5E50_40%,#3D4E42_100%)]" />
          )}
        </div>

        <div className="relative z-10 mx-auto -mt-20 max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 rounded-[2rem] border border-[#E8DED0] bg-[#FFFDFC]/95 p-5 shadow-[0_20px_60px_-32px_rgba(63,48,31,0.38)] backdrop-blur-sm sm:p-8 lg:flex-row lg:gap-8">
            <div className="min-w-0 flex-1">
              <div className="pawfinder-fade-up">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="inline-flex rounded-full border border-[#D4C7B6] bg-[#F7F0E7] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#6E6A63]">
                    {categoryLabel}
                  </span>
                  {isVerifiedBusiness && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#3D5A45]/20 bg-[#3D5A45]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#3D5A45]">
                      <CheckCircle className="h-4 w-4" />
                      Verified Profile
                    </span>
                  )}
                </div>

                <h1 className="font-display text-4xl font-bold tracking-[-0.03em] text-[#2F312E] sm:text-5xl">
                  {provider.name}
                </h1>
              </div>

              <div className="pawfinder-fade-up-delay-1 mt-7 rounded-[1.75rem] border border-[#E4D4B0] bg-[linear-gradient(180deg,#FFF7E8_0%,#FFFDF8_100%)] p-5 shadow-[0_16px_38px_-30px_rgba(123,90,29,0.45)] sm:p-6">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="collar-tag collar-tag-large">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-sm font-black text-[#6A5121] shadow-sm">
                      G
                    </span>
                    <div className="leading-tight">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8E6A20]/75">
                        Google Rating
                      </div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-black sm:text-[2rem]">
                          {liveDetails?.rating ? `${liveDetails.rating}` : 'N/A'}
                        </span>
                        <span className="text-sm font-semibold text-[#8E6A20]/80">/ 5</span>
                      </div>
                      <div className="mt-2">
                        {renderFilledStars(liveDetails?.rating, {
                          sizeClassName: 'h-4 w-4',
                          filledClassName: 'fill-amber-400 text-amber-400',
                          emptyClassName: 'text-[#D9C8A6]',
                        })}
                      </div>
                    </div>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7A5A19]">
                      {typeof liveDetails?.user_ratings_total === 'number'
                        ? `${liveDetails.user_ratings_total} reviews`
                        : 'Live'}
                    </span>
                  </div>
                </div>

                {visibleAiSummary ? (
                  <div className="mt-5 rounded-[1.5rem] border border-[#E4D6C0] bg-[#FFFDF8] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <div className="inline-flex items-center rounded-full bg-[#F3E3B7] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#7A5A19]">
                        User Review Summary
                      </div>
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#4D5A50]">
                        <ShieldCheck className="h-4 w-4 text-[#3D5A45]" />
                        <span>{visibleAiSummarySourceLabel}</span>
                      </div>
                      {provider.review_summary && liveDetails?.ai_summary && (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${visibleAiSummaryAccentClass}`}
                        >
                          Showing native summary first
                        </span>
                      )}
                    </div>
                    <p className="max-w-3xl text-[15px] leading-7 text-[#454541] sm:text-base">
                      {visibleAiSummary}
                    </p>
                  </div>
                ) : (
                  <div className="mt-5 rounded-[1.5rem] border border-dashed border-[#DDCEB2] bg-[#FFFBF2] p-4 text-sm text-[#6E6A63]">
                    We are still gathering enough review detail to show a short trust summary for this business.
                  </div>
                )}
              </div>

              <div className="pawfinder-fade-up-delay-2 mt-6 flex flex-wrap items-start gap-3 text-[#5D5B55]">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#DED3C5] bg-[#F7F0E7] px-4 py-2 text-sm font-medium shadow-sm">
                  <MapPin className="h-4 w-4 text-[#3D5A45]" />
                  <span>{locationLabel}</span>
                </div>
                <div
                  className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold shadow-sm ${
                    isOpenNow === true
                      ? 'border border-[#3D5A45]/15 bg-[#3D5A45]/10 text-[#3D5A45]'
                      : isOpenNow === false
                        ? 'border border-[#DCCFBF] bg-[#F4ECE2] text-[#6E6A63]'
                        : 'border border-[#E6DCCE] bg-[#FBF7F1] text-[#9A948B]'
                  }`}
                >
                  {isOpenNow === true ? 'Open now' : isOpenNow === false ? 'Closed now' : 'Opening hours unavailable'}
                </div>
              </div>

              <div className="pawfinder-fade-up-delay-2 mt-8 grid gap-5 lg:grid-cols-2">
                <div className="rounded-[1.75rem] border border-[#E5DBCF] bg-[#FFF8F2] p-5 shadow-[0_18px_40px_-34px_rgba(61,90,69,0.45)]">
                  <h3 className="font-display text-lg font-bold uppercase tracking-[0.16em] text-[#5A5A52]">
                    Service Categories
                  </h3>
                  <div className="mt-3">
                    {isAnalysisPending ? (
                      <div className="pawfinder-fade-up rounded-[1.35rem] border border-dashed border-[#DCCFC0] bg-[#FFFDFC] px-4 py-5">
                        <div className="flex items-center gap-3">
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#E2D5C8] border-t-[#3D5A45]" />
                          <div className="text-sm font-medium text-[#4E514B]">{analysisLoadingLabel}</div>
                        </div>
                        <div className="mt-4 space-y-2">
                          <div className="h-4 w-28 animate-pulse rounded-full bg-[#E8DDD0]" />
                          <div className="flex flex-wrap gap-2">
                            <div className="h-8 w-24 animate-pulse rounded-full bg-[#E8DDD0]" />
                            <div className="h-8 w-20 animate-pulse rounded-full bg-[#E8DDD0]" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-[#3D5A45]/20 bg-[#3D5A45]/12 px-3 py-1.5 text-sm font-medium text-[#3D5A45]">
                            {categoryLabel}
                          </span>
                          {visibleConfirmedServiceLabels.map((service, index) => (
                            <span
                              key={service}
                              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-transform duration-200 hover:-translate-y-0.5 ${
                                index === 0
                                  ? 'border-[#DDD1C4] bg-[#FFFDF8] text-[#5F5A52]'
                                  : 'border-[#E7DDD2] bg-[#F7F1EA] text-[#6E6A63]'
                              }`}
                            >
                              {service}
                            </span>
                          ))}
                        </div>

                        {visibleInferredServiceLabels.length > 0 && (
                          <div className="rounded-[1.25rem] border border-dashed border-[#D7CCBE] bg-[#FFFDFC] p-4">
                            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8A8176]">
                              Inferred from business name
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {visibleInferredServiceLabels.map((service) => (
                                <span
                                  key={service}
                                  className="rounded-full border border-[#E5D9C8] bg-[#FBF6EE] px-3 py-1.5 text-sm font-medium text-[#6F675C]"
                                >
                                  {service}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-[#E5DBCF] bg-[#FFF8F2] p-5 shadow-[0_18px_40px_-34px_rgba(61,90,69,0.45)]">
                  <h3 className="font-display text-lg font-bold uppercase tracking-[0.16em] text-[#5A5A52]">
                    Breeds Supported
                  </h3>
                  <div className="mt-3 space-y-4">
                    {isAnalysisPending ? (
                      <div className="pawfinder-fade-up rounded-[1.35rem] border border-dashed border-[#DCCFC0] bg-[#FFFDFC] px-4 py-5">
                        <div className="flex items-center gap-3">
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#E2D5C8] border-t-[#3D5A45]" />
                          <div className="text-sm font-medium text-[#4E514B]">{analysisLoadingLabel}</div>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-[#938E86]">
                          Breed and animal coverage will appear here once the current analysis finishes.
                        </p>
                        <div className="mt-4 space-y-3">
                          <div className="h-4 w-32 animate-pulse rounded-full bg-[#E8DDD0]" />
                          <div className="flex flex-wrap gap-2">
                            <div className="h-8 w-28 animate-pulse rounded-full bg-[#E8DDD0]" />
                            <div className="h-8 w-24 animate-pulse rounded-full bg-[#E8DDD0]" />
                            <div className="h-8 w-20 animate-pulse rounded-full bg-[#E8DDD0]" />
                          </div>
                        </div>
                      </div>
                    ) : consolidatedBreedBadges.length > 0 ? (
                      <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                          {consolidatedBreedBadges.map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-[#DED4C6] bg-[#FFFDF8] px-3 py-1.5 text-sm font-medium text-[#5F5A52]"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                        {showNoSpecificBreedNote && (
                          <div className="rounded-[1.1rem] border border-dashed border-[#DCCFC0] bg-[#FFFDFC] px-4 py-3">
                            <div className="text-sm font-medium text-[#585850]">
                              Specific breed coverage could not be confirmed from the available photos.
                            </div>
                            <p className="mt-1 text-xs leading-5 text-[#938E86]">
                              The general animal coverage above is saved, but no breed-specific support could be verified.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-[#DED4C6] bg-[#FFFDF8] px-3 py-1.5 text-sm font-medium text-[#5F5A52]">
                          🐾 Contact provider for details
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pawfinder-fade-up-delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
                {callNumber && (
                  <button
                    onClick={() => {
                      setShowCallPopup(true)
                      handleContactAction('phone_click')
                    }}
                    className="pressable-soft rounded-full border border-[#3D5A45] bg-[#3D5A45] px-6 py-3 font-semibold text-white shadow-[0_14px_32px_-22px_rgba(61,90,69,0.85)] hover:bg-[#324A39]"
                  >
                    Call Business
                  </button>
                )}
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pressable-soft inline-flex items-center justify-center gap-2 rounded-full border border-[#D6CCBD] bg-[#FFFDFC] px-6 py-3 text-center font-semibold text-[#344136] shadow-[0_14px_32px_-24px_rgba(61,90,69,0.35)] hover:bg-[#F7F0E7]"
                >
                  <MapPin className="h-4 w-4" />
                  <span>Get Directions</span>
                </a>
                {websiteUrl && (
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => handleContactAction('website_click')}
                    className="pressable-soft rounded-full border border-[#D8C4A6] bg-[#FFF8ED] px-6 py-3 text-center font-semibold text-[#6A5121] shadow-[0_14px_32px_-24px_rgba(122,90,25,0.65)] hover:bg-[#FFF1D7]"
                  >
                    Visit Website
                  </a>
                )}
                {bookingUrl && (
                  <a
                    href={bookingUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => handleContactAction('booking_click')}
                    className="pressable-soft rounded-full border border-[#C97C5D]/20 bg-[#C97C5D] px-6 py-3 text-center font-semibold text-white shadow-[0_14px_32px_-24px_rgba(145,84,60,0.7)] hover:bg-[#B96E52]"
                  >
                    Book Online
                  </a>
                )}
              </div>
            </div>

            <div className="pawfinder-fade-up-delay-2 w-full rounded-[1.9rem] border border-[#E5DBCF] bg-[#FFF8F1] p-5 shadow-[0_22px_42px_-34px_rgba(60,48,35,0.42)] sm:p-6 lg:w-[21rem] lg:flex-none">
                <h3 className="font-display mb-4 flex items-center gap-2 text-lg font-bold text-[#344136]">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-black text-[#7A5A19] shadow-sm">
                    G
                  </span>
                  Trust Snapshot
                </h3>
                <div className="rounded-[1.5rem] border border-[#E4D4B0] bg-[linear-gradient(180deg,#FFF3D9_0%,#FFF9EC_100%)] px-4 py-5 shadow-[0_18px_34px_-28px_rgba(123,90,29,0.8)]">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D1F]/80">
                    Google Rating
                  </div>
                  <div className="mt-2 text-4xl font-black text-[#7A5A19]">{liveDetails?.rating || 'N/A'}</div>
                  <p className="mt-1 text-sm font-semibold text-[#8a6d1f]/80">
                    {typeof liveDetails?.user_ratings_total === 'number'
                      ? `${liveDetails.user_ratings_total} reviews live from Google Places`
                      : 'Live from Google Places'}
                  </p>
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8A8176]">
                      Gallery
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowGalleryInfo((current) => !current)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#DDD1C4] bg-white/80 text-[#6E6A63] shadow-sm transition-colors hover:bg-white"
                        aria-label="Why are gallery images unavailable?"
                        aria-expanded={showGalleryInfo}
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                      {showGalleryInfo ? (
                        <div className="absolute right-0 top-9 z-20 w-44 rounded-2xl border border-[#E5DBCF] bg-white px-3 py-2 text-xs font-medium leading-5 text-[#5D5A54] shadow-[0_18px_36px_-28px_rgba(60,48,35,0.45)]">
                          Images not available during beta testing. 🐾
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {lockedGallerySlots.map((slot) => (
                      <div
                        key={slot}
                        className="relative aspect-[4/3] min-h-[6.25rem] overflow-hidden rounded-[1rem] border border-[#E5DBCF] bg-[linear-gradient(180deg,rgba(248,238,225,0.96)_0%,rgba(243,232,216,0.96)_100%)]"
                      >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.7),transparent_52%),linear-gradient(180deg,rgba(255,255,255,0.34)_0%,rgba(255,255,255,0.08)_100%)]" />
                        <div className="absolute inset-[12%] overflow-hidden rounded-[0.9rem] border border-white/35 bg-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                          <div className="absolute inset-0 scale-110 opacity-70 blur-md">
                            <Image
                              src="/pet-placeholder.svg"
                              alt=""
                              fill
                              sizes="160px"
                              className="object-cover"
                            />
                          </div>
                          <div className="absolute inset-0 bg-white/20" />
                        </div>
                        <div className="absolute inset-x-3 bottom-3 rounded-full border border-white/45 bg-white/70 px-3 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7C7468] backdrop-blur-sm">
                          Beta gallery preview
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 rounded-[1.5rem] border border-[#E7DDD1] bg-[#FFFDFC] p-4 text-sm leading-6 text-[#5D5A54]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8A8176]">
                    Profile Atmosphere
                  </div>
                  <p className="mt-2">
                    PawFinder keeps live Google trust signals and saved breed and service analysis visually separate so pet owners can scan what is confirmed at a glance.
                  </p>
                </div>
            </div>
          </div>

          {isFeaturedProfile && liveReviews.length > 0 && (
            <div className="mt-8 rounded-[1.9rem] border border-[#E5DBCF] bg-[#FFFDFC] p-5 shadow-[0_18px_40px_-34px_rgba(60,48,35,0.2)] sm:p-8">
              <h2 className="font-display text-2xl font-bold text-[#344136]">Google Review Preview</h2>
              <p className="mt-1 text-sm text-[#77736B]">
                Showing up to 5 live Google reviews for the nearest result you opened from search.
              </p>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {liveReviews.slice(0, 5).map((review: LiveReview, index: number) => (
                  <div
                    key={`${review.author_name || 'review'}-${index}`}
                    className="rounded-[1.5rem] border border-[#E7DDD1] bg-[#FBF7F1] p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-semibold text-[#2F312E]">{review.author_name || 'Google review'}</span>
                        <div className="mt-1 text-xs uppercase tracking-wide text-[#938E86]">
                          {review.relative_time_description || 'Recent'}
                        </div>
                      </div>
                      <div className="collar-tag collar-tag-small text-sm font-semibold">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-[10px] font-black text-[#6A5121] shadow-sm">
                          G
                        </span>
                        {renderFilledStars(review.rating, {
                          sizeClassName: 'h-3.5 w-3.5',
                          filledClassName: 'fill-amber-400 text-amber-400',
                          emptyClassName: 'text-[#D9C8A6]',
                        })}
                        <span className="rounded-full bg-white/65 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7A5A19]">
                          review
                        </span>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-[#5D5A54]">{review.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showTemperamentReviews ? (
            <div className="mt-12">
              <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="flex items-center gap-3 text-3xl font-bold text-stone-900">
                    Temperament Reviews
                    <span className="rounded-full bg-[#829e8d] px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">Native</span>
                  </h2>
                  <p className="mt-1 text-stone-500">Verified handling and environment ratings from real pet owners.</p>
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
                  <h3 className="mb-6 text-xl font-bold">Write a Temperament Review</h3>
                  <form onSubmit={submitReview} className="space-y-6">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-stone-700">Pet Breed (e.g. Rescue Greyhound)</label>
                      <input required type="text" value={reviewForm.dog_breed} onChange={e => setReviewForm({...reviewForm, dog_breed: e.target.value})} className="w-full rounded-md border border-stone-300 px-3 py-2" />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-stone-700">Handling Rating (1-5)</label>
                        <input type="number" min="1" max="5" value={reviewForm.handling_rating} onChange={e => setReviewForm({...reviewForm, handling_rating: parseInt(e.target.value)})} className="w-full rounded-md border border-stone-300 px-3 py-2" />
                        <p className="mt-1 text-xs text-stone-500">How well did they handle your pet&apos;s specific needs?</p>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-stone-700">Environment Rating (1-5)</label>
                        <input type="number" min="1" max="5" value={reviewForm.environment_rating} onChange={e => setReviewForm({...reviewForm, environment_rating: parseInt(e.target.value)})} className="w-full rounded-md border border-stone-300 px-3 py-2" />
                        <p className="mt-1 text-xs text-stone-500">Was the environment calm, chaotic, secure?</p>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-stone-700">Temperament Tags</label>
                      <div className="flex flex-wrap gap-2">
                        {availableTags.map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${reviewForm.temperament_tags.includes(tag) ? 'bg-[#829e8d] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-stone-700">Comment</label>
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
                    <Star className="mx-auto mb-4 h-12 w-12 text-stone-300" />
                    <h3 className="mb-2 text-xl font-bold text-stone-800">No temperament reviews yet</h3>
                    <p className="mb-6 text-stone-500">Be the first to leave a breed-specific review for this business!</p>
                    <button
                      onClick={() => setShowReviewForm(true)}
                      className="rounded-full bg-[#829e8d] px-6 py-2 font-semibold text-white transition-colors hover:bg-[#6c8676]"
                    >
                      Write the first review
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {pf_reviews.map((review) => {
                      const reviewerName = review.pf_profiles?.full_name || 'Anonymous User'
                      const handlingRating = review.handling_rating || 0
                      const environmentRating = review.environment_rating || 0
                      const temperamentTags = review.temperament_tags || []

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
                            <div className="rounded-full bg-[#829e8d]/10 px-3 py-2 text-[#6c8676]">
                              {renderFilledStars(getReviewAverage(review), {
                                sizeClassName: 'h-3.5 w-3.5',
                                filledClassName: 'fill-[#6c8676] text-[#6c8676]',
                                emptyClassName: 'text-[#B8C8BF]',
                              })}
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
                              <div className="mt-2">
                                {renderFilledStars(handlingRating, {
                                  sizeClassName: 'h-4 w-4',
                                  filledClassName: 'fill-[#E07A5F] text-[#E07A5F]',
                                  emptyClassName: 'text-stone-300',
                                })}
                              </div>
                            </div>
                            <div className="rounded-xl bg-stone-50 p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Environment</div>
                              <div className="mt-2">
                                {renderFilledStars(environmentRating, {
                                  sizeClassName: 'h-4 w-4',
                                  filledClassName: 'fill-[#E07A5F] text-[#E07A5F]',
                                  emptyClassName: 'text-stone-300',
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50/70 p-4">
                            <p className="text-sm leading-6 text-stone-700">{review.comment}</p>
                          </div>

                          {temperamentTags.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {temperamentTags.map((tag: string) => (
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
          ) : null}
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

      {shouldShowActionToast ? (
        <ActionTriggerToast
          providerId={provider.id}
          actionType={activeContactAction}
          visible={shouldShowActionToast}
          onClose={closeActionToast}
        />
      ) : null}
    </div>
  )
}
