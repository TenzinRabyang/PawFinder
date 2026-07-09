type CacheableRecord = Record<string, unknown>

type CacheableProviderSnapshot = CacheableRecord & {
  google_place_id?: string | null
  id?: string | null
}

type CacheableLiveDetails = CacheableRecord & {
  place_id?: string | null
}

type CacheableFeaturedEnrichment = CacheableRecord & {
  google_place_id?: string | null
  id?: string | null
}

type ProviderSessionCacheEntry = {
  providerSnapshot?: CacheableProviderSnapshot
  liveDetails?: CacheableLiveDetails
  reviewsSnapshot?: CacheableRecord[]
  featuredEnrichment?: CacheableFeaturedEnrichment
}

type ProviderSessionCacheUpdate = Partial<ProviderSessionCacheEntry>

const providerSessionCache = new Map<string, ProviderSessionCacheEntry>()

function normalizePlaceId(placeId: string | null | undefined) {
  if (typeof placeId !== 'string') return null

  const trimmedPlaceId = placeId.trim()
  return trimmedPlaceId || null
}

function mergeCacheEntry(
  currentEntry: ProviderSessionCacheEntry | undefined,
  nextEntry: ProviderSessionCacheUpdate
): ProviderSessionCacheEntry {
  return {
    providerSnapshot: nextEntry.providerSnapshot
      ? { ...(currentEntry?.providerSnapshot || {}), ...nextEntry.providerSnapshot }
      : currentEntry?.providerSnapshot,
    liveDetails: nextEntry.liveDetails
      ? { ...(currentEntry?.liveDetails || {}), ...nextEntry.liveDetails }
      : currentEntry?.liveDetails,
    reviewsSnapshot: typeof nextEntry.reviewsSnapshot !== 'undefined'
      ? nextEntry.reviewsSnapshot
      : currentEntry?.reviewsSnapshot,
    featuredEnrichment: nextEntry.featuredEnrichment
      ? { ...(currentEntry?.featuredEnrichment || {}), ...nextEntry.featuredEnrichment }
      : currentEntry?.featuredEnrichment,
  }
}

function getCacheKeys(placeId: string | null | undefined, entry?: ProviderSessionCacheUpdate) {
  const resolvedKeys = [
    normalizePlaceId(placeId),
    normalizePlaceId(entry?.providerSnapshot?.google_place_id),
    normalizePlaceId(entry?.providerSnapshot?.id),
    normalizePlaceId(entry?.liveDetails?.place_id),
    normalizePlaceId(entry?.featuredEnrichment?.google_place_id),
    normalizePlaceId(entry?.featuredEnrichment?.id),
  ].filter((value): value is string => Boolean(value))

  return Array.from(new Set(resolvedKeys))
}

export function getProviderSessionCache(placeId: string | null | undefined) {
  const normalizedPlaceId = normalizePlaceId(placeId)
  if (!normalizedPlaceId) return null

  return providerSessionCache.get(normalizedPlaceId) || null
}

export function primeProviderSessionCache(
  placeId: string | null | undefined,
  entry: ProviderSessionCacheUpdate
) {
  const cacheKeys = getCacheKeys(placeId, entry)
  if (cacheKeys.length === 0) return

  const existingEntry =
    cacheKeys
      .map((cacheKey) => providerSessionCache.get(cacheKey))
      .find((cachedEntry) => typeof cachedEntry !== 'undefined') || undefined

  const mergedEntry = mergeCacheEntry(existingEntry, entry)

  for (const cacheKey of cacheKeys) {
    providerSessionCache.set(cacheKey, mergedEntry)
  }
}
