import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_PLACE_ID_REFRESH_ATTEMPTS = 3

type RecoveryAwareProvider = {
  id?: string
  google_place_id?: string | null
  name?: string | null
  address?: string | null
  phone?: string | null
  website?: string | null
  place_id_refresh_attempt_count?: number | null
  place_id_refresh_exhausted?: boolean | null
}

type GooglePlaceCandidate = {
  place_id?: string
  name?: string
  formatted_address?: string
  business_status?: string
  website?: string
  formatted_phone_number?: string
}

type GooglePlaceDetailsResponse = {
  status?: string
  result?: Record<string, any>
  candidates?: GooglePlaceCandidate[]
  results?: GooglePlaceCandidate[]
  error_message?: string
}

export type PlaceDetailsResolution =
  | {
      status: 'OK'
      result: Record<string, any>
      requestedPlaceId: string
      resolvedPlaceId: string
      healed: boolean
    }
  | {
      status: string
      result: null
      requestedPlaceId: string
      resolvedPlaceId: null
      healed: false
      errorMessage?: string
    }

function normalizeText(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPostcode(value?: string | null) {
  const match = value?.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)
  return match ? match[0].replace(/\s+/g, '') : ''
}

function getPlaceIdRefreshAttemptCount(provider?: RecoveryAwareProvider | null) {
  return typeof provider?.place_id_refresh_attempt_count === 'number' &&
    Number.isFinite(provider.place_id_refresh_attempt_count)
    ? provider.place_id_refresh_attempt_count
    : 0
}

function hasPlaceIdRefreshAttemptsRemaining(provider?: RecoveryAwareProvider | null) {
  if (provider?.place_id_refresh_exhausted) {
    return false
  }

  return getPlaceIdRefreshAttemptCount(provider) < MAX_PLACE_ID_REFRESH_ATTEMPTS
}

function buildPlaceIdRefreshPersistence(provider?: RecoveryAwareProvider | null, healed = false) {
  const nextAttemptCount = getPlaceIdRefreshAttemptCount(provider) + 1
  return {
    place_id_refresh_attempt_count: nextAttemptCount,
    place_id_refresh_exhausted: healed ? false : nextAttemptCount >= MAX_PLACE_ID_REFRESH_ATTEMPTS,
  }
}

function isMissingPlaceIdRefreshColumnError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST204' &&
    typeof error.message === 'string' &&
    (error.message.includes('place_id_refresh_attempt_count') ||
      error.message.includes('place_id_refresh_exhausted'))
  )
}

async function persistProviderPlaceIdRefreshState(
  supabase: SupabaseClient,
  providerId: string,
  updatePayload: Record<string, any>
) {
  const { error } = await supabase.from('pf_providers').update(updatePayload).eq('id', providerId)

  if (!isMissingPlaceIdRefreshColumnError(error)) {
    return { error }
  }

  const retryPayload = { ...updatePayload }
  delete retryPayload.place_id_refresh_attempt_count
  delete retryPayload.place_id_refresh_exhausted

  if (Object.keys(retryPayload).length === 0) {
    return { error: null }
  }

  const { error: retryError } = await supabase.from('pf_providers').update(retryPayload).eq('id', providerId)
  return { error: retryError }
}

export async function getProviderForPlaceIdRecovery(supabase: SupabaseClient, googlePlaceId: string) {
  const selectWithRefreshState =
    'id, google_place_id, name, address, phone, website, place_id_refresh_attempt_count, place_id_refresh_exhausted'

  const query = () =>
    supabase.from('pf_providers').select(selectWithRefreshState).eq('google_place_id', googlePlaceId).maybeSingle()

  const { data, error } = await query()

  if (!isMissingPlaceIdRefreshColumnError(error)) {
    return { data, error }
  }

  return supabase
    .from('pf_providers')
    .select('id, google_place_id, name, address, phone, website')
    .eq('google_place_id', googlePlaceId)
    .maybeSingle()
}

async function fetchGoogleJson(url: string, timeoutMs = 10000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  return (await response.json()) as GooglePlaceDetailsResponse
}

async function fetchPlaceDetailsById(placeId: string, fields: string, key: string) {
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}` +
    `&fields=${encodeURIComponent(fields)}&key=${key}`
  return fetchGoogleJson(url)
}

function buildRecoveryQueries(provider?: RecoveryAwareProvider | null) {
  const name = provider?.name?.trim()
  const address = provider?.address?.trim()

  if (!name) return []

  return Array.from(new Set([`${name} ${address || ''}`.trim(), name]))
}

function scoreCandidate(candidate: GooglePlaceCandidate, provider?: RecoveryAwareProvider | null) {
  const targetName = normalizeText(provider?.name)
  const candidateName = normalizeText(candidate.name)
  const targetAddress = normalizeText(provider?.address)
  const candidateAddress = normalizeText(candidate.formatted_address)
  const targetPostcode = extractPostcode(provider?.address)
  const candidatePostcode = extractPostcode(candidate.formatted_address)

  let score = 0

  if (candidateName && candidateName === targetName) {
    score += 6
  } else if (
    candidateName &&
    targetName &&
    (candidateName.includes(targetName) || targetName.includes(candidateName))
  ) {
    score += 3
  }

  if (targetPostcode && candidatePostcode && targetPostcode === candidatePostcode) {
    score += 2
  } else if (targetAddress && candidateAddress) {
    const targetTokens = new Set(targetAddress.split(' ').filter(Boolean))
    const overlap = candidateAddress.split(' ').filter((token) => targetTokens.has(token)).length
    if (overlap >= 2) score += 1
  }

  if (provider?.phone?.trim() && candidate.formatted_phone_number?.trim() === provider.phone.trim()) {
    score += 2
  }

  if (provider?.website?.trim() && candidate.website?.trim() === provider.website.trim()) {
    score += 2
  }

  if (candidate.business_status === 'OPERATIONAL') {
    score += 1
  }

  return score
}

function pickConfidentCandidate(candidates: GooglePlaceCandidate[], provider?: RecoveryAwareProvider | null) {
  const scored = candidates
    .filter((candidate) => candidate.place_id && candidate.name)
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, provider) }))
    .sort((left, right) => right.score - left.score)

  const [best, runnerUp] = scored
  if (!best || best.score < 6) {
    return null
  }

  if (runnerUp && best.score === runnerUp.score) {
    return null
  }

  return best.candidate
}

async function searchForReplacementPlaceId(provider: RecoveryAwareProvider | null | undefined, key: string) {
  const candidates: GooglePlaceCandidate[] = []

  for (const query of buildRecoveryQueries(provider)) {
    const findUrl =
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}` +
      '&inputtype=textquery' +
      '&fields=place_id,name,formatted_address,business_status' +
      `&key=${key}`
    const findResponse = await fetchGoogleJson(findUrl)
    candidates.push(...(findResponse.candidates || []))

    const textUrl =
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}` +
      `&key=${key}`
    const textResponse = await fetchGoogleJson(textUrl)
    candidates.push(...(textResponse.results || []))
  }

  const deduped = Array.from(
    new Map(candidates.filter((candidate) => candidate.place_id).map((candidate) => [candidate.place_id!, candidate]))
      .values()
  )

  return pickConfidentCandidate(deduped, provider)
}

export async function resolvePlaceDetailsWithAutoHeal({
  requestedPlaceId,
  fields,
  googleApiKey,
  provider,
  supabase,
  source,
}: {
  requestedPlaceId: string
  fields: string
  googleApiKey: string
  provider?: RecoveryAwareProvider | null
  supabase?: SupabaseClient
  source: string
}): Promise<PlaceDetailsResolution> {
  const detailsResponse = await fetchPlaceDetailsById(requestedPlaceId, fields, googleApiKey)

  if (detailsResponse.status === 'OK' && detailsResponse.result) {
    return {
      status: 'OK',
      result: detailsResponse.result,
      requestedPlaceId,
      resolvedPlaceId: String(detailsResponse.result.place_id || requestedPlaceId),
      healed: false,
    }
  }

  if (detailsResponse.status !== 'NOT_FOUND' || !hasPlaceIdRefreshAttemptsRemaining(provider)) {
    return {
      status: detailsResponse.status || 'UNKNOWN_ERROR',
      result: null,
      requestedPlaceId,
      resolvedPlaceId: null,
      healed: false,
      errorMessage: detailsResponse.error_message,
    }
  }

  const replacementCandidate = await searchForReplacementPlaceId(provider, googleApiKey)

  if (!replacementCandidate?.place_id || replacementCandidate.place_id === requestedPlaceId) {
    if (provider?.id && supabase) {
      const persistence = buildPlaceIdRefreshPersistence(provider, false)
      const { error } = await persistProviderPlaceIdRefreshState(supabase, provider.id, persistence)
      if (error) {
        console.error('[place-id-recovery] failed to persist exhausted attempt state', {
          source,
          providerId: provider.id,
          requestedPlaceId,
          error,
        })
      }
    }

    console.warn('[place-id-recovery] unable to resolve replacement place id', {
      source,
      requestedPlaceId,
      providerId: provider?.id || null,
      providerName: provider?.name || null,
      providerAddress: provider?.address || null,
    })

    return {
      status: detailsResponse.status || 'NOT_FOUND',
      result: null,
      requestedPlaceId,
      resolvedPlaceId: null,
      healed: false,
      errorMessage: detailsResponse.error_message,
    }
  }

  const healedResponse = await fetchPlaceDetailsById(replacementCandidate.place_id, fields, googleApiKey)
  if (healedResponse.status !== 'OK' || !healedResponse.result) {
    return {
      status: healedResponse.status || 'UNKNOWN_ERROR',
      result: null,
      requestedPlaceId,
      resolvedPlaceId: null,
      healed: false,
      errorMessage: healedResponse.error_message,
    }
  }

  const resolvedPlaceId = String(healedResponse.result.place_id || replacementCandidate.place_id)

  if (provider?.id && supabase) {
    const persistence = buildPlaceIdRefreshPersistence(provider, true)
    const { error } = await persistProviderPlaceIdRefreshState(supabase, provider.id, {
      google_place_id: resolvedPlaceId,
      ...persistence,
    })

    if (error) {
      console.error('[place-id-recovery] failed to persist healed place id mapping', {
        source,
        providerId: provider.id,
        requestedPlaceId,
        resolvedPlaceId,
        error,
      })
    }
  }

  console.info('[place-id-recovery] healed obsolete place id', {
    source,
    providerId: provider?.id || null,
    providerName: provider?.name || healedResponse.result.name || null,
    fromPlaceId: requestedPlaceId,
    toPlaceId: resolvedPlaceId,
  })

  return {
    status: 'OK',
    result: healedResponse.result,
    requestedPlaceId,
    resolvedPlaceId,
    healed: true,
  }
}
