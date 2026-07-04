export const PERSISTABLE_PROVIDER_CATEGORIES = [
  'vet',
  'groomer',
  'walker',
  'kennel',
  'pet_shop',
  'trainer',
  'sitter',
  'mobile_service',
] as const

export const PROVIDER_CATEGORIES = [
  ...PERSISTABLE_PROVIDER_CATEGORIES,
  'pet_care',
] as const

export type PersistableProviderCategory = (typeof PERSISTABLE_PROVIDER_CATEGORIES)[number]
export type ProviderCategory = PersistableProviderCategory | 'pet_care'

const VALID_PROVIDER_CATEGORIES = new Set<string>(PROVIDER_CATEGORIES)
const VALID_PERSISTABLE_PROVIDER_CATEGORIES = new Set<string>(PERSISTABLE_PROVIDER_CATEGORIES)

export function isProviderCategory(value: string | null | undefined): value is ProviderCategory {
  return typeof value === 'string' && VALID_PROVIDER_CATEGORIES.has(value)
}

export function isPersistableProviderCategory(value: string | null | undefined): value is PersistableProviderCategory {
  return typeof value === 'string' && VALID_PERSISTABLE_PROVIDER_CATEGORIES.has(value)
}

type ResolveProviderCategoryInput = {
  requestedCategory?: string | null
  googleTypes?: string[] | null
  name?: string | null
  website?: string | null
}

function resolveCategoryFromText(name?: string | null, website?: string | null): ProviderCategory | null {
  const searchableText = `${name || ''} ${website || ''}`.toLowerCase()

  if (!searchableText.trim()) {
    return null
  }

  if (/\bvet|veterinary|animal hospital|vets\b/.test(searchableText)) return 'vet'
  if (/\bmobile\b/.test(searchableText)) return 'mobile_service'
  if (/\bgroom|groomer|grooming|pet spa|dog spa|salon\b/.test(searchableText)) return 'groomer'
  if (/\btrainer|training|behaviour|behavior\b/.test(searchableText)) return 'trainer'
  if (/\bwalker|walking|walkies|dog walk|dog walking\b/.test(searchableText)) return 'walker'
  if (/\bsitter|sitting|pet sitting|cat sitting|dog sitting|home dog care|home pet care\b/.test(searchableText)) return 'sitter'
  if (/\bboarding|kennel|kennels|dog hotel|hotel for pets|pet hotel|day care|daycare|hutches|lodge\b/.test(searchableText)) return 'kennel'

  if (
    /\bpet shop|pet store|pet supplies|pet food|pet nutrition|aquatics|animal feeds|pet retail|pet products|pet accessories\b/.test(
      searchableText
    )
  ) {
    return 'pet_shop'
  }

  return null
}

type ResolvePersistableProviderCategoryInput = ResolveProviderCategoryInput & {
  services?: string[] | null
}

export function resolvePersistableProviderCategory({
  requestedCategory,
  googleTypes,
  name,
  website,
  services,
}: ResolvePersistableProviderCategoryInput): PersistableProviderCategory | null {
  const directCategory = resolveProviderCategory({
    requestedCategory,
    googleTypes,
    name,
    website,
  })

  if (isPersistableProviderCategory(directCategory)) {
    return directCategory
  }

  const normalizedServices = Array.isArray(services)
    ? services.map((value) => value.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean)
    : []
  const serviceText = normalizedServices.join(' ')

  if (/\bvaccination|surgery|diagnostic|veterinary|vet\b/.test(serviceText)) return 'vet'
  if (/\bgroom/.test(serviceText)) return 'groomer'
  if (/\bwalk/.test(serviceText)) return 'walker'
  if (/\bsitt|home_visit|drop_in/.test(serviceText)) return 'sitter'
  if (/\bboard|daycare|day_care|kennel|lodg/.test(serviceText)) return 'kennel'
  if (/\btrain/.test(serviceText)) return 'trainer'
  if (/\bfood|retail|shop|store|supply|product/.test(serviceText)) return 'pet_shop'
  if (/\bmobile/.test(serviceText)) return 'mobile_service'

  return null
}

export function resolveProviderCategory({
  requestedCategory,
  googleTypes,
  name,
  website,
}: ResolveProviderCategoryInput) {
  if (isProviderCategory(requestedCategory) && requestedCategory !== 'pet_care') {
    return requestedCategory
  }

  const normalizedTypes = Array.isArray(googleTypes)
    ? googleTypes.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
    : []

  if (normalizedTypes.includes('veterinary_care')) return 'vet'
  if (normalizedTypes.includes('pet_store')) return 'pet_shop'
  if (normalizedTypes.includes('pet_groomer')) return 'groomer'
  if (normalizedTypes.includes('dog_trainer')) return 'trainer'
  if (normalizedTypes.includes('dog_walker')) return 'walker'
  if (normalizedTypes.includes('pet_sitter')) return 'sitter'
  if (normalizedTypes.includes('pet_boarding_service')) return 'kennel'
  if (normalizedTypes.includes('store')) {
    const searchableText = `${name || ''} ${website || ''}`.toLowerCase()
    if (
      searchableText.includes('pet') ||
      searchableText.includes('pets') ||
      searchableText.includes('petshop') ||
      searchableText.includes('pet-shop') ||
      searchableText.includes('pet store') ||
      searchableText.includes('pet supplies')
    ) {
      return 'pet_shop'
    }
  }

  return resolveCategoryFromText(name, website) || 'pet_care'
}
