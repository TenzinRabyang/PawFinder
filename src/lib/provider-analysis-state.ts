export const MAX_AUTO_TAGGING_ATTEMPTS = 3

type AnalysisFields = {
  ai_tagged_at?: string | null
  ai_tagging_skipped_low_content?: boolean | null
  animals_served?: string[] | null
  services?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
  tagging_attempt_count?: number | null
  breed_analysis_exhausted?: boolean | null
  website?: string | null
}

export type BreedAnalysisStatus =
  | 'confirmed'
  | 'retrying'
  | 'photo_retrying'
  | 'photo_exhausted'
  | 'unavailable'
  | 'fetch_blocked'
  | 'no_website'
  | 'services_only'

function getLength(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.length : 0
}

function hasNoWebsite(provider: AnalysisFields) {
  return typeof provider.website !== 'undefined' && !provider.website?.trim()
}

export function hasMeaningfulBreedAnalysis(provider: AnalysisFields) {
  return (
    getLength(provider.breeds_specialised) > 0 ||
    getLength(provider.animals_served) > 0 ||
    getLength(provider.breeds_general_inferred) > 0
  )
}

export function hasPartialServiceAnalysis(provider: AnalysisFields) {
  return Boolean(provider.ai_tagged_at) && getLength(provider.services) > 0 && !hasMeaningfulBreedAnalysis(provider)
}

export function hasSavedBreedCoverage(provider: AnalysisFields) {
  return getLength(provider.breeds_specialised) > 0 || getLength(provider.breeds_general_inferred) > 0
}

export function hasBlockedWebsiteFetch(provider: AnalysisFields) {
  // Reuse the existing "skipped" flag for blocked homepage fetches; unlike true low-content skips,
  // blocked fetches never set ai_tagged_at, so the two states remain distinguishable.
  return (
    !provider.ai_tagged_at &&
    Boolean(provider.ai_tagging_skipped_low_content) &&
    getTaggingAttemptCount(provider) > 0 &&
    !hasMeaningfulBreedAnalysis(provider)
  )
}

export function getTaggingAttemptCount(provider: AnalysisFields) {
  return typeof provider.tagging_attempt_count === 'number' && Number.isFinite(provider.tagging_attempt_count)
    ? provider.tagging_attempt_count
    : 0
}

export function hasAnalysisAttemptsRemaining(provider: AnalysisFields) {
  if (provider.breed_analysis_exhausted) {
    return false
  }

  return getTaggingAttemptCount(provider) < MAX_AUTO_TAGGING_ATTEMPTS
}

export function getNextTaggingAttemptCount(provider: AnalysisFields) {
  return getTaggingAttemptCount(provider) + 1
}

export function shouldAutoRetryBreedAnalysis(provider: AnalysisFields) {
  if (hasMeaningfulBreedAnalysis(provider)) {
    return false
  }

  if (hasNoWebsite(provider)) {
    return false
  }

  if (!provider.ai_tagged_at) {
    return hasAnalysisAttemptsRemaining(provider)
  }

  return hasAnalysisAttemptsRemaining(provider)
}

export function shouldRefreshIncompleteBreedCoverage(provider: AnalysisFields) {
  return (
    Boolean(provider.ai_tagged_at) &&
    getLength(provider.animals_served) > 0 &&
    !hasSavedBreedCoverage(provider) &&
    getTaggingAttemptCount(provider) === 0 &&
    hasAnalysisAttemptsRemaining(provider)
  )
}

export function getBreedAnalysisStatus(provider: AnalysisFields): BreedAnalysisStatus {
  if (hasMeaningfulBreedAnalysis(provider)) {
    return 'confirmed'
  }

  if (hasNoWebsite(provider)) {
    if (getTaggingAttemptCount(provider) > 0) {
      return hasAnalysisAttemptsRemaining(provider) ? 'photo_retrying' : 'photo_exhausted'
    }

    return 'no_website'
  }

  if (hasBlockedWebsiteFetch(provider)) {
    return 'fetch_blocked'
  }

  if (hasPartialServiceAnalysis(provider) && !hasAnalysisAttemptsRemaining(provider)) {
    return 'services_only'
  }

  return shouldAutoRetryBreedAnalysis(provider) ? 'retrying' : 'unavailable'
}

export function getBreedAnalysisPersistence(
  provider: AnalysisFields,
  nextData: Pick<AnalysisFields, 'animals_served' | 'services' | 'breeds_specialised' | 'breeds_general_inferred'>
) {
  const taggingAttemptCount = getNextTaggingAttemptCount(provider)
  const meaningfulResult =
    getLength(nextData.animals_served) > 0 ||
    getLength(nextData.breeds_specialised) > 0 ||
    getLength(nextData.breeds_general_inferred) > 0

  return {
    taggingAttemptCount,
    breedAnalysisExhausted: meaningfulResult ? false : taggingAttemptCount >= MAX_AUTO_TAGGING_ATTEMPTS,
  }
}
