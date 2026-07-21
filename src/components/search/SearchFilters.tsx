'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownWideNarrow, Filter, MapPin, Search, X } from 'lucide-react'

export type SortOption = 'distance' | 'rating' | 'review_count'
export type SearchCategory = '' | 'sitter' | 'groomer' | 'vet' | 'pet_shop'
export type TargetSpecies =
  | 'dogs'
  | 'cats'
  | 'birds'
  | 'small_animals'
  | 'reptiles_exotics'

export type SearchFilterState = {
  location: string
  category: SearchCategory
  species: TargetSpecies[]
  careType: '' | 'overnight_stay' | 'day_visit' | 'drop_in'
  environment: '' | 'solo_pet_environment' | 'multi_pet_friendly'
  capabilities: Array<'medication_administration' | 'senior_special_care' | 'constant_supervision'>
  breedTags: string[]
  handlingNeeds: Array<'anxious_fear_free' | 'giant_breeds_50kg_plus' | 'double_coat_de_shedding'>
  isEmergency247: boolean
  offersHouseCalls: boolean
  hasRawPrescriptionDiets: boolean
}

type SearchFiltersProps = {
  initialState: SearchFilterState
  sortBy: SortOption
  isApplyingFilters: boolean
  locationError: string | null
  searchLimitMessage: string | null
  onApply: (filters: SearchFilterState) => void | Promise<void>
  onSortChange: (value: SortOption) => void
  showSortControl?: boolean
}

const CATEGORY_OPTIONS: Array<{ value: SearchCategory; label: string }> = [
  { value: '', label: 'All Categories' },
  { value: 'sitter', label: 'Sitter' },
  { value: 'groomer', label: 'Groomer' },
  { value: 'vet', label: 'Vet' },
  { value: 'pet_shop', label: 'Pet Shop' },
]

const SPECIES_OPTIONS: Array<{ value: TargetSpecies; label: string }> = [
  { value: 'dogs', label: 'Dogs' },
  { value: 'cats', label: 'Cats' },
  { value: 'birds', label: 'Birds' },
  { value: 'small_animals', label: 'Small Animals' },
  { value: 'reptiles_exotics', label: 'Reptiles / Exotics' },
]

const SITTER_CAPABILITY_OPTIONS: Array<{
  value: SearchFilterState['capabilities'][number]
  label: string
}> = [
  { value: 'medication_administration', label: 'Medication Administration' },
  { value: 'senior_special_care', label: 'Senior / Special Care' },
  { value: 'constant_supervision', label: 'Constant Supervision' },
]

const GROOMER_HANDLING_OPTIONS: Array<{
  value: SearchFilterState['handlingNeeds'][number]
  label: string
}> = [
  { value: 'anxious_fear_free', label: 'Anxious / Fear-Free' },
  { value: 'giant_breeds_50kg_plus', label: 'Giant Breeds (50kg+)' },
  { value: 'double_coat_de_shedding', label: 'Double-Coat De-shedding' },
]

const emptyPreferenceState = {
  careType: '',
  environment: '',
  capabilities: [],
  breedTags: [],
  handlingNeeds: [],
  isEmergency247: false,
  offersHouseCalls: false,
  hasRawPrescriptionDiets: false,
} satisfies Omit<SearchFilterState, 'location' | 'category' | 'species'>

export function normalizeBreedTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function sanitizeFiltersForCategory(filters: SearchFilterState): SearchFilterState {
  if (filters.category === 'sitter') {
    return {
      ...filters,
      breedTags: [],
      handlingNeeds: [],
      isEmergency247: false,
      offersHouseCalls: false,
      hasRawPrescriptionDiets: false,
    }
  }

  if (filters.category === 'groomer') {
    return {
      ...filters,
      careType: '',
      environment: '',
      capabilities: [],
      isEmergency247: false,
      offersHouseCalls: false,
      hasRawPrescriptionDiets: false,
    }
  }

  if (filters.category === 'vet' || filters.category === 'pet_shop') {
    return {
      ...filters,
      careType: '',
      environment: '',
      capabilities: [],
      breedTags: [],
      handlingNeeds: [],
    }
  }

  return {
    ...filters,
    ...emptyPreferenceState,
  }
}

function PillButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
        active
          ? 'border-[#3D5A45] bg-[#3D5A45] text-white shadow-sm'
          : 'border-stone-200 bg-white text-stone-600 hover:border-[#B9C8BE] hover:text-stone-900'
      }`}
    >
      {label}
    </button>
  )
}

export default function SearchFilters({
  initialState,
  sortBy,
  isApplyingFilters,
  locationError,
  searchLimitMessage,
  onApply,
  onSortChange,
  showSortControl = true,
}: SearchFiltersProps) {
  const [draft, setDraft] = useState<SearchFilterState>(initialState)
  const [breedDraft, setBreedDraft] = useState('')

  useEffect(() => {
    setDraft(initialState)
    setBreedDraft('')
  }, [initialState])

  const cleanedDraft = useMemo(() => sanitizeFiltersForCategory(draft), [draft])

  const updateDraft = (updater: SearchFilterState | ((current: SearchFilterState) => SearchFilterState)) => {
    setDraft((current) => {
      const nextValue = typeof updater === 'function' ? updater(current) : updater
      return sanitizeFiltersForCategory(nextValue)
    })
  }

  const toggleSpecies = (species: TargetSpecies) => {
    updateDraft((current) => ({
      ...current,
      species: current.species.includes(species)
        ? current.species.filter((value) => value !== species)
        : [...current.species, species],
    }))
  }

  const toggleCapability = (value: SearchFilterState['capabilities'][number]) => {
    updateDraft((current) => ({
      ...current,
      capabilities: current.capabilities.includes(value)
        ? current.capabilities.filter((item) => item !== value)
        : [...current.capabilities, value],
    }))
  }

  const toggleHandlingNeed = (value: SearchFilterState['handlingNeeds'][number]) => {
    updateDraft((current) => ({
      ...current,
      handlingNeeds: current.handlingNeeds.includes(value)
        ? current.handlingNeeds.filter((item) => item !== value)
        : [...current.handlingNeeds, value],
    }))
  }

  const addBreedTag = () => {
    const normalized = normalizeBreedTag(breedDraft)
    if (!normalized) return

    updateDraft((current) => ({
      ...current,
      breedTags: current.breedTags.includes(normalized)
        ? current.breedTags
        : [...current.breedTags, normalized],
    }))
    setBreedDraft('')
  }

  const removeBreedTag = (tag: string) => {
    updateDraft((current) => ({
      ...current,
      breedTags: current.breedTags.filter((value) => value !== tag),
    }))
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-4">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4 w-4 text-stone-500" />
        <h2 className="text-base font-semibold text-stone-800">Filters</h2>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onApply(cleanedDraft)
        }}
        className="space-y-4"
      >
        <div
          className={`grid gap-3 lg:items-end ${
            showSortControl
              ? 'lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]'
              : 'lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_auto]'
          }`}
        >
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Location
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 focus-within:border-[#829e8d] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#829e8d]">
              <MapPin className="h-4 w-4 flex-shrink-0 text-stone-400" />
              <input
                type="text"
                value={draft.location}
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, location: event.target.value }))
                }
                placeholder="City, town, or postcode"
                className="w-full bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Category
            </label>
            <select
              value={draft.category}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  category: event.target.value as SearchCategory,
                }))
              }
              className="w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:border-[#829e8d] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#829e8d]"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {showSortControl ? (
            <div>
              <label className="mb-1 flex items-center text-xs font-medium uppercase tracking-wide text-stone-500">
                <ArrowDownWideNarrow className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
                Sort Results
              </label>
              <select
                value={sortBy}
                onChange={(event) => onSortChange(event.target.value as SortOption)}
                className="w-full rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:border-[#829e8d] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#829e8d]"
              >
                <option value="distance">Distance</option>
                <option value="rating">Review Star</option>
                <option value="review_count">Review Count</option>
              </select>
            </div>
          ) : null}

          <div>
            <button
              type="submit"
              disabled={isApplyingFilters}
              className="w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400 lg:w-auto lg:min-w-[126px]"
            >
              {isApplyingFilters ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-[#E7E1D7] bg-[#FAF8F3] p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C5B4D]">
                Hard Filters
              </p>
              <h3 className="mt-1 text-sm font-semibold text-stone-900">Who and what must this search cover?</h3>
            </div>
            <p className="text-xs text-stone-500">These are your strict search constraints.</p>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">
              Target Species
            </label>
            <div className="flex flex-wrap gap-2">
              {SPECIES_OPTIONS.map((option) => (
                <PillButton
                  key={option.value}
                  active={draft.species.includes(option.value)}
                  label={option.label}
                  onClick={() => toggleSpecies(option.value)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-stone-100 bg-stone-50/50 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6C7468]">
                Preference Filters
              </p>
              <h3 className="mt-1 text-sm font-semibold text-stone-900">
                Extra needs that help refine the best fit
              </h3>
            </div>
            <p className="text-xs text-stone-500">
              Preferences reset automatically when you switch category.
            </p>
          </div>

          {draft.category === 'sitter' ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">
                  Care Type
                </label>
                <div className="flex flex-wrap gap-2">
                  <PillButton
                    active={draft.careType === 'overnight_stay'}
                    label="Overnight Stay"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        careType: current.careType === 'overnight_stay' ? '' : 'overnight_stay',
                      }))
                    }
                  />
                  <PillButton
                    active={draft.careType === 'day_visit'}
                    label="Day Visit"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        careType: current.careType === 'day_visit' ? '' : 'day_visit',
                      }))
                    }
                  />
                  <PillButton
                    active={draft.careType === 'drop_in'}
                    label="Drop-in"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        careType: current.careType === 'drop_in' ? '' : 'drop_in',
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">
                  Environment
                </label>
                <div className="flex flex-wrap gap-2">
                  <PillButton
                    active={draft.environment === 'solo_pet_environment'}
                    label="Solo Pet Environment"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        environment:
                          current.environment === 'solo_pet_environment' ? '' : 'solo_pet_environment',
                      }))
                    }
                  />
                  <PillButton
                    active={draft.environment === 'multi_pet_friendly'}
                    label="Multi-pet Friendly"
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        environment:
                          current.environment === 'multi_pet_friendly' ? '' : 'multi_pet_friendly',
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">
                  Capabilities
                </label>
                <div className="flex flex-wrap gap-2">
                  {SITTER_CAPABILITY_OPTIONS.map((option) => (
                    <PillButton
                      key={option.value}
                      active={draft.capabilities.includes(option.value)}
                      label={option.label}
                      onClick={() => toggleCapability(option.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {draft.category === 'groomer' ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">
                  Breed Search
                </label>
                <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                  <div className="flex gap-2">
                    <div className="flex flex-1 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2 focus-within:border-[#829e8d] focus-within:bg-white">
                      <Search className="h-4 w-4 text-stone-400" />
                      <input
                        type="text"
                        value={breedDraft}
                        onChange={(event) => setBreedDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ',') {
                            event.preventDefault()
                            addBreedTag()
                          }
                        }}
                        placeholder="Add breed or coat type"
                        className="w-full bg-transparent text-sm text-stone-700 outline-none placeholder:text-stone-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addBreedTag}
                      className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-[#B9C8BE] hover:text-stone-900"
                    >
                      Add
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {draft.breedTags.length > 0 ? (
                      draft.breedTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-2 rounded-full border border-[#D8C4A6] bg-[#FFF8ED] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#6A5121]"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeBreedTag(tag)}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/80 text-[#6A5121]"
                            aria-label={`Remove ${tag}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <p className="text-xs text-stone-500">
                        Add free-text tags for mixed breeds, rare breeds, or coat-specific needs.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-stone-500">
                  Handling Needs
                </label>
                <div className="flex flex-wrap gap-2">
                  {GROOMER_HANDLING_OPTIONS.map((option) => (
                    <PillButton
                      key={option.value}
                      active={draft.handlingNeeds.includes(option.value)}
                      label={option.label}
                      onClick={() => toggleHandlingNeed(option.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {draft.category === 'vet' || draft.category === 'pet_shop' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <PillButton
                active={draft.isEmergency247}
                label="24 / 7 Emergency"
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    isEmergency247: !current.isEmergency247,
                  }))
                }
              />
              <PillButton
                active={draft.offersHouseCalls}
                label="House Calls / Mobile"
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    offersHouseCalls: !current.offersHouseCalls,
                  }))
                }
              />
              <PillButton
                active={draft.hasRawPrescriptionDiets}
                label="Raw / Prescription Diets"
                onClick={() =>
                  updateDraft((current) => ({
                    ...current,
                    hasRawPrescriptionDiets: !current.hasRawPrescriptionDiets,
                  }))
                }
              />
            </div>
          ) : null}

          {draft.category === '' ? (
            <p className="mt-4 text-sm leading-6 text-stone-500">
              Pick a category to unlock sitter, groomer, vet, or pet shop preference filters.
            </p>
          ) : null}
        </section>

        {locationError && <p className="text-[11px] leading-relaxed text-[#B14A2B]">{locationError}</p>}

        {searchLimitMessage && (
          <p className="text-[11px] leading-relaxed text-[#B14A2B]">{searchLimitMessage}</p>
        )}

        <p className="text-[11px] leading-relaxed text-stone-400">
          Hard filters narrow the search. Preference filters capture special care needs and stay URL-shareable
          without leaking stale category params.
        </p>
      </form>
    </div>
  )
}
