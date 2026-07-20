import { getAnimalForBreed } from '@/lib/breed-taxonomy'

export type SearchProviderRecord = {
  category?: string | null
  name?: string | null
  address?: string | null
  subscription_tier?: string | null
  is_claimed?: boolean | null
  distance_miles?: number | null
  google_rating?: {
    score?: number | null
    count?: number | null
  } | null
  native_rating?: {
    score?: number | null
    count?: number | null
  } | null
  animals_served?: string[] | null
  services?: string[] | null
  services_inferred_from_name?: string[] | null
  breeds_specialised?: string[] | null
  breeds_general_inferred?: string[] | null
}

export type NeedsBasedSearchFilters = {
  species: Array<'dogs' | 'cats' | 'birds' | 'small_animals' | 'reptiles_exotics'>
  careType: '' | 'overnight_stay' | 'day_visit' | 'drop_in'
  environment: '' | 'solo_pet_environment' | 'multi_pet_friendly'
  capabilities: Array<'medication_administration' | 'senior_special_care' | 'constant_supervision'>
  breedTags: string[]
  handlingNeeds: Array<'anxious_fear_free' | 'giant_breeds_50kg_plus' | 'double_coat_de_shedding'>
  emergency247: boolean
  houseCalls: boolean
  rawDiets: boolean
  legacyAnimal: string
  legacyService: string
  legacyBreed: string
}

export type SearchMatchFields = {
  match_count: number
  match_score: number
  preference_count: number
  matched_preferences: string[]
  breed_match_type?: 'specific' | 'general_inferred'
}

const SPECIES_TO_PROVIDER_TOKENS = {
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
} as const

const CARE_TYPE_SIGNAL_MAP = {
  overnight_stay: ['boarding', 'overnight', 'overnight_care', 'kennel_services', 'pet_sitting'],
  day_visit: ['daycare', 'day_care', 'day_visit', 'home_visit', 'pet_sitting', 'visit'],
  drop_in: ['drop_in', 'dropin', 'drop_in_visit', 'home_visit', 'pet_sitting', 'visit'],
} as const

const ENVIRONMENT_SIGNAL_MAP = {
  solo_pet_environment: ['solo_pet_environment', 'pet_free', 'pet_only', 'solo'],
  multi_pet_friendly: ['multi_pet_friendly', 'multi_pet', 'boarding', 'daycare', 'kennel_services'],
} as const

const CAPABILITY_SIGNAL_MAP = {
  medication_administration: ['medication', 'medications', 'medication_administration', 'meds', 'injectable'],
  senior_special_care: ['senior', 'senior_care', 'special_care', 'special_needs', 'rehabilitation'],
  constant_supervision: ['constant_supervision', 'supervision', '24_7', 'daycare', 'boarding'],
} as const

const HANDLING_SIGNAL_MAP = {
  anxious_fear_free: ['fear_free', 'anxious', 'reactive', 'calm_handling', 'stress_free'],
  giant_breeds_50kg_plus: ['giant_breeds', 'giant_breeds_50kg_plus', 'large_breed', 'large_dog', 'big_dogs'],
  double_coat_de_shedding: ['double_coat', 'deshedding', 'de_shedding', 'undercoat'],
} as const

const EMERGENCY_SIGNAL_TOKENS = ['24_7', '24hr', '24hrs', 'emergency', 'emergency_care', 'out_of_hours']
const HOUSE_CALL_SIGNAL_TOKENS = ['house_calls', 'house_call', 'mobile', 'mobile_service', 'home_visit']
const RAW_DIET_SIGNAL_TOKENS = ['raw', 'raw_diets', 'prescription', 'prescription_diet', 'prescription_diets']

function normalizeToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\s/+.-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
}

function normalizePhrase(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function dedupeValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function getListParam(searchParams: URLSearchParams, key: string, normalizer: (value: string) => string = normalizeToken) {
  return dedupeValues(
    searchParams
      .getAll(key)
      .map((value) => normalizer(value))
      .filter(Boolean)
  )
}

function getProviderSpecies(provider: SearchProviderRecord) {
  const normalizedTokens = [
    ...(provider.animals_served || []),
    ...(provider.breeds_general_inferred || []),
  ].map(normalizeToken)

  const supportedSpecies = new Set<NeedsBasedSearchFilters['species'][number]>()

  for (const [species, tokens] of Object.entries(SPECIES_TO_PROVIDER_TOKENS) as Array<
    [NeedsBasedSearchFilters['species'][number], readonly string[]]
  >) {
    if (tokens.some((token) => normalizedTokens.includes(token))) {
      supportedSpecies.add(species)
    }
  }

  return supportedSpecies
}

function buildProviderSignals(provider: SearchProviderRecord) {
  const rawValues = [
    provider.name || '',
    provider.address || '',
    provider.category || '',
    ...(provider.services || []),
    ...(provider.services_inferred_from_name || []),
    ...(provider.animals_served || []),
    ...(provider.breeds_specialised || []),
    ...(provider.breeds_general_inferred || []),
  ]

  const tokens = new Set<string>()
  const phrases = new Set<string>()

  for (const rawValue of rawValues) {
    const token = normalizeToken(rawValue)
    if (token) {
      tokens.add(token)
      token.split('_').filter(Boolean).forEach((part) => tokens.add(part))
    }

    const phrase = normalizePhrase(rawValue)
    if (phrase) {
      phrases.add(phrase)
    }
  }

  return {
    tokens,
    phrases,
    species: getProviderSpecies(provider),
    breeds: new Set((provider.breeds_specialised || []).map(normalizePhrase).filter(Boolean)),
    generalCoverage: new Set((provider.breeds_general_inferred || []).map(normalizeToken).filter(Boolean)),
  }
}

function providerMatchesAnySignal(
  provider: SearchProviderRecord,
  signals: readonly string[],
  providerSignals = buildProviderSignals(provider)
) {
  return signals.some((signal) => {
    const token = normalizeToken(signal)
    const phrase = normalizePhrase(signal)
    return providerSignals.tokens.has(token) || providerSignals.phrases.has(phrase)
  })
}

function isSparseUnclaimedProvider(provider: SearchProviderRecord) {
  return (
    provider.subscription_tier === 'free' &&
    !provider.is_claimed &&
    (!provider.animals_served || provider.animals_served.length === 0) &&
    (!provider.services || provider.services.length === 0) &&
    (!provider.breeds_specialised || provider.breeds_specialised.length === 0) &&
    (!provider.breeds_general_inferred || provider.breeds_general_inferred.length === 0)
  )
}

function providerMatchesLegacyBreed(
  provider: SearchProviderRecord,
  breed: string,
  providerSignals = buildProviderSignals(provider)
) {
  if (!breed) return { matches: true }

  const normalizedBreed = normalizePhrase(breed)
  if (providerSignals.breeds.has(normalizedBreed)) {
    return { matches: true, breed_match_type: 'specific' as const }
  }

  const inferredAnimal = getAnimalForBreed(breed)
  if (inferredAnimal && providerSignals.generalCoverage.has(normalizeToken(inferredAnimal))) {
    return { matches: true, breed_match_type: 'general_inferred' as const }
  }

  return { matches: false }
}

function getReviewScore(provider: SearchProviderRecord) {
  if (typeof provider.native_rating?.score === 'number') return provider.native_rating.score
  if (typeof provider.google_rating?.score === 'number') return provider.google_rating.score
  return -1
}

function getReviewCount(provider: SearchProviderRecord) {
  if (typeof provider.native_rating?.count === 'number') return provider.native_rating.count
  if (typeof provider.google_rating?.count === 'number') return provider.google_rating.count
  return -1
}

function getDistance(provider: SearchProviderRecord) {
  return typeof provider.distance_miles === 'number' ? provider.distance_miles : Number.POSITIVE_INFINITY
}

export function parseNeedsBasedSearchFilters(searchParams: URLSearchParams): NeedsBasedSearchFilters {
  const normalizedSpecies = getListParam(searchParams, 'species') as NeedsBasedSearchFilters['species']
  const careType = searchParams.get('careType')
  const environment = searchParams.get('environment')

  return {
    species: normalizedSpecies.filter((value) =>
      ['dogs', 'cats', 'birds', 'small_animals', 'reptiles_exotics'].includes(value)
    ) as NeedsBasedSearchFilters['species'],
    careType:
      careType === 'overnight_stay' || careType === 'day_visit' || careType === 'drop_in'
        ? careType
        : '',
    environment:
      environment === 'solo_pet_environment' || environment === 'multi_pet_friendly'
        ? environment
        : '',
    capabilities: getListParam(searchParams, 'capability').filter((value) =>
      ['medication_administration', 'senior_special_care', 'constant_supervision'].includes(value)
    ) as NeedsBasedSearchFilters['capabilities'],
    breedTags: getListParam(searchParams, 'breedTag', normalizePhrase),
    handlingNeeds: getListParam(searchParams, 'handlingNeed').filter((value) =>
      ['anxious_fear_free', 'giant_breeds_50kg_plus', 'double_coat_de_shedding'].includes(value)
    ) as NeedsBasedSearchFilters['handlingNeeds'],
    emergency247: searchParams.get('emergency247') === 'true',
    houseCalls: searchParams.get('houseCalls') === 'true',
    rawDiets: searchParams.get('rawDiets') === 'true',
    legacyAnimal: normalizeToken(searchParams.get('animal') || ''),
    legacyService: normalizeToken(searchParams.get('service') || ''),
    legacyBreed: normalizePhrase(searchParams.get('breed') || ''),
  }
}

export function applyNeedsBasedFilters<T extends SearchProviderRecord>(
  providers: T[],
  filters: NeedsBasedSearchFilters
): Array<T & SearchMatchFields> {
  const filteredProviders = providers.filter((provider) => {
    const providerSignals = buildProviderSignals(provider)
    const sparseUnclaimed = isSparseUnclaimedProvider(provider)

    if (filters.species.length > 0) {
      if (providerSignals.species.size === 0) return false
      if (!filters.species.every((species) => providerSignals.species.has(species))) return false
    }

    if (filters.emergency247 && !providerMatchesAnySignal(provider, EMERGENCY_SIGNAL_TOKENS, providerSignals)) {
      return false
    }

    if (sparseUnclaimed) {
      return !filters.legacyAnimal && !filters.legacyService && !filters.legacyBreed
    }

    if (filters.legacyAnimal && providerSignals.species.size > 0) {
      const mappedLegacySpecies =
        filters.legacyAnimal === 'dog'
          ? 'dogs'
          : filters.legacyAnimal === 'cat'
            ? 'cats'
            : filters.legacyAnimal === 'bird'
              ? 'birds'
              : filters.legacyAnimal === 'rabbit' || filters.legacyAnimal === 'small_animal'
                ? 'small_animals'
                : filters.legacyAnimal === 'reptile' || filters.legacyAnimal === 'exotic'
                  ? 'reptiles_exotics'
                  : null

      if (mappedLegacySpecies && !providerSignals.species.has(mappedLegacySpecies)) {
        return false
      }
    }

    if (
      filters.legacyService &&
      (provider.services?.length || provider.services_inferred_from_name?.length) &&
      !providerMatchesAnySignal(provider, [filters.legacyService], providerSignals)
    ) {
      return false
    }

    if (filters.legacyBreed) {
      const breedMatch = providerMatchesLegacyBreed(provider, filters.legacyBreed, providerSignals)
      if (!breedMatch.matches) {
        return false
      }
    }

    return true
  })

  const scoredProviders = filteredProviders.map((provider) => {
    const providerSignals = buildProviderSignals(provider)
    let matchCount = 0
    let preferenceCount = 0
    const matchedPreferences: string[] = []
    let breedMatchType: SearchMatchFields['breed_match_type']

    if (filters.careType) {
      preferenceCount += 1
      if (providerMatchesAnySignal(provider, CARE_TYPE_SIGNAL_MAP[filters.careType], providerSignals)) {
        matchCount += 1
        matchedPreferences.push(filters.careType)
      }
    }

    if (filters.environment) {
      preferenceCount += 1
      if (providerMatchesAnySignal(provider, ENVIRONMENT_SIGNAL_MAP[filters.environment], providerSignals)) {
        matchCount += 1
        matchedPreferences.push(filters.environment)
      }
    }

    for (const capability of filters.capabilities) {
      preferenceCount += 1
      if (providerMatchesAnySignal(provider, CAPABILITY_SIGNAL_MAP[capability], providerSignals)) {
        matchCount += 1
        matchedPreferences.push(capability)
      }
    }

    for (const handlingNeed of filters.handlingNeeds) {
      preferenceCount += 1
      if (providerMatchesAnySignal(provider, HANDLING_SIGNAL_MAP[handlingNeed], providerSignals)) {
        matchCount += 1
        matchedPreferences.push(handlingNeed)
      }
    }

    if (filters.houseCalls) {
      preferenceCount += 1
      if (providerMatchesAnySignal(provider, HOUSE_CALL_SIGNAL_TOKENS, providerSignals)) {
        matchCount += 1
        matchedPreferences.push('houseCalls')
      }
    }

    if (filters.rawDiets) {
      preferenceCount += 1
      if (providerMatchesAnySignal(provider, RAW_DIET_SIGNAL_TOKENS, providerSignals)) {
        matchCount += 1
        matchedPreferences.push('rawDiets')
      }
    }

    for (const breedTag of filters.breedTags) {
      preferenceCount += 1
      const breedMatch = providerMatchesLegacyBreed(provider, breedTag, providerSignals)
      if (breedMatch.matches) {
        matchCount += 1
        matchedPreferences.push(`breed:${breedTag}`)
        if (!breedMatchType && breedMatch.breed_match_type) {
          breedMatchType = breedMatch.breed_match_type
        }
      }
    }

    if (!breedMatchType && filters.legacyBreed) {
      const breedMatch = providerMatchesLegacyBreed(provider, filters.legacyBreed, providerSignals)
      if (breedMatch.matches && breedMatch.breed_match_type) {
        breedMatchType = breedMatch.breed_match_type
      }
    }

    return {
      ...provider,
      match_count: matchCount,
      match_score: preferenceCount > 0 ? Number((matchCount / preferenceCount).toFixed(3)) : 0,
      preference_count: preferenceCount,
      matched_preferences: matchedPreferences,
      ...(breedMatchType ? { breed_match_type: breedMatchType } : {}),
    }
  })

  return scoredProviders.sort((a, b) => {
    if (b.match_score !== a.match_score) return b.match_score - a.match_score
    if (b.match_count !== a.match_count) return b.match_count - a.match_count

    const reviewScoreDifference = getReviewScore(b) - getReviewScore(a)
    if (reviewScoreDifference !== 0) return reviewScoreDifference

    const reviewCountDifference = getReviewCount(b) - getReviewCount(a)
    if (reviewCountDifference !== 0) return reviewCountDifference

    return getDistance(a) - getDistance(b)
  })
}
