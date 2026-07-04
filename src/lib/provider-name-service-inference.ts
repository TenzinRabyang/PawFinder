import type { ProviderCategory } from '@/lib/provider-category'

const SERVICE_KEYWORD_PATTERNS: Array<{ service: string; pattern: RegExp }> = [
  { service: 'grooming', pattern: /\bgroom|groomer|grooming|pet spa|dog spa|salon\b/i },
  { service: 'dog_walking', pattern: /\bwalker|walking|walkies|dog walk|dog walking\b/i },
  { service: 'pet_sitting', pattern: /\bsitter|sitting|pet sitting|cat sitting|dog sitting|home dog care|home pet care\b/i },
  { service: 'boarding', pattern: /\bboarding|boarders?|dog hotel|pet hotel|overnight care|lodging|lodges?\b/i },
  { service: 'kennel_services', pattern: /\bkennel|kennels\b/i },
  { service: 'training', pattern: /\btrainer|training|behaviour|behavior\b/i },
  { service: 'daycare', pattern: /\bday care|daycare|doggy day care|doggy daycare\b/i },
  { service: 'veterinary_care', pattern: /\bvet|vets|veterinary|animal hospital\b/i },
  {
    service: 'pet_food_retail',
    pattern: /\bpet shop|pet store|pet supplies|pet food|pet nutrition|aquatics|pet retail|pet products|pet accessories\b/i,
  },
  { service: 'mobile_service', pattern: /\bmobile\b/i },
]

const CATEGORY_EQUIVALENT_INFERRED_SERVICES: Record<ProviderCategory, string[]> = {
  vet: ['veterinary_care'],
  groomer: ['grooming'],
  walker: ['dog_walking'],
  kennel: ['kennel_services', 'boarding'],
  pet_shop: ['pet_food_retail'],
  trainer: ['training'],
  sitter: ['pet_sitting'],
  mobile_service: ['mobile_service'],
  pet_care: [],
}

function normalizeServiceValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

export function getCategoryEquivalentInferredServices(category?: string | null) {
  if (!category) return []

  const typedCategory = category as ProviderCategory
  return CATEGORY_EQUIVALENT_INFERRED_SERVICES[typedCategory] || []
}

export function inferServicesFromBusinessName({
  name,
  category,
  confirmedServices,
}: {
  name?: string | null
  category?: string | null
  confirmedServices?: string[] | null
}) {
  const normalizedName = name?.trim() || ''
  if (!normalizedName) return []

  const existingConfirmedServices = new Set(
    Array.isArray(confirmedServices) ? confirmedServices.map(normalizeServiceValue) : []
  )
  const categoryEquivalentServices = new Set(getCategoryEquivalentInferredServices(category))
  const inferredServices = new Set<string>()

  for (const { service, pattern } of SERVICE_KEYWORD_PATTERNS) {
    if (pattern.test(normalizedName)) {
      inferredServices.add(service)
    }
  }

  return Array.from(inferredServices).filter(
    (service) => !existingConfirmedServices.has(service) && !categoryEquivalentServices.has(service)
  )
}

export function removeCategoryDuplicateServices({
  category,
  services,
}: {
  category?: string | null
  services?: string[] | null
}) {
  const categoryEquivalentServices = new Set(getCategoryEquivalentInferredServices(category))
  const normalizedServices = Array.isArray(services)
    ? services.map(normalizeServiceValue).filter(Boolean)
    : []

  return normalizedServices.filter((service) => !categoryEquivalentServices.has(service))
}
