export const BREED_OPTIONS = [
  { value: 'labrador retriever', label: 'Labrador Retriever', animal: 'dog' },
  { value: 'french bulldog', label: 'French Bulldog', animal: 'dog' },
  { value: 'golden retriever', label: 'Golden Retriever', animal: 'dog' },
  { value: 'german shepherd', label: 'German Shepherd', animal: 'dog' },
  { value: 'cocker spaniel', label: 'Cocker Spaniel', animal: 'dog' },
  { value: 'cockapoo', label: 'Cockapoo', animal: 'dog' },
  { value: 'border collie', label: 'Border Collie', animal: 'dog' },
  { value: 'dachshund', label: 'Dachshund', animal: 'dog' },
  { value: 'chihuahua', label: 'Chihuahua', animal: 'dog' },
  { value: 'staffordshire bull terrier', label: 'Staffordshire Bull Terrier', animal: 'dog' },
  { value: 'cavalier king charles spaniel', label: 'Cavalier King Charles Spaniel', animal: 'dog' },
  { value: 'poodle', label: 'Poodle', animal: 'dog' },
  { value: 'shih tzu', label: 'Shih Tzu', animal: 'dog' },
  { value: 'jack russell terrier', label: 'Jack Russell Terrier', animal: 'dog' },
  { value: 'pug', label: 'Pug', animal: 'dog' },
  { value: 'greyhound', label: 'Greyhound', animal: 'dog' },
  { value: 'whippet', label: 'Whippet', animal: 'dog' },
  { value: 'british shorthair', label: 'British Shorthair', animal: 'cat' },
  { value: 'ragdoll', label: 'Ragdoll', animal: 'cat' },
  { value: 'maine coon', label: 'Maine Coon', animal: 'cat' },
  { value: 'persian', label: 'Persian', animal: 'cat' },
  { value: 'siamese', label: 'Siamese', animal: 'cat' },
  { value: 'mini lop', label: 'Mini Lop', animal: 'rabbit' },
  { value: 'netherland dwarf', label: 'Netherland Dwarf', animal: 'rabbit' },
] as const

export const BREED_VALUES = BREED_OPTIONS.map((breed) => breed.value)

export const BREED_VALUES_BY_ANIMAL = {
  dog: BREED_OPTIONS.filter((breed) => breed.animal === 'dog').map((breed) => breed.value),
  cat: BREED_OPTIONS.filter((breed) => breed.animal === 'cat').map((breed) => breed.value),
  rabbit: BREED_OPTIONS.filter((breed) => breed.animal === 'rabbit').map((breed) => breed.value),
}

const BREED_ANIMAL_MAP = new Map<string, string>(BREED_OPTIONS.map((breed) => [breed.value, breed.animal]))

export function normalizeBreedValues(values: unknown) {
  if (!Array.isArray(values)) return []

  const validBreedValues = new Set<string>(BREED_VALUES)
  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value): value is string => Boolean(value) && validBreedValues.has(value))

  return Array.from(new Set(normalized))
}

export function normalizeGeneralAnimalCoverage(values: unknown) {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value): value is string => ['dog', 'cat', 'rabbit'].includes(value))

  return Array.from(new Set(normalized))
}

export function getAnimalForBreed(value: string) {
  return BREED_ANIMAL_MAP.get(value) || null
}
