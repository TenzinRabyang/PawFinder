'use client'

import { useMemo, useState } from 'react'

type NoResultsFeedbackProps = {
  searchTerm: string
  category: string | null
  species: string[]
  location: string | null
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

export default function NoResultsFeedback({
  searchTerm,
  category,
  species,
  location,
}: NoResultsFeedbackProps) {
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const summaryLine = useMemo(() => {
    const parts = [category, species.length > 0 ? species.join(', ') : null, location].filter(Boolean)
    return parts.length > 0 ? parts.join(' • ') : 'your current search'
  }, [category, location, species])

  const handleSubmit = async () => {
    if (submitState === 'submitting' || submitState === 'success') return

    setSubmitState('submitting')
    setErrorMessage(null)

    try {
      const response = await fetch('/api/feedback/search-intent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          search_term: searchTerm,
          category,
          species,
          location,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error || 'We could not save your search intent just now.')
      }

      setSubmitState('success')
    } catch (error) {
      setSubmitState('error')
      setErrorMessage(error instanceof Error ? error.message : 'We could not save your search intent just now.')
    }
  }

  return (
    <div className="rounded-2xl border border-[#E5DBCF] bg-[linear-gradient(180deg,#FFF9F3_0%,#FFFDFC_100%)] p-6 text-left shadow-[0_18px_40px_-32px_rgba(32,38,31,0.34)] sm:p-7">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C5B4D]">
          No Results Found
        </p>
        <h3 className="mt-2 text-xl font-semibold text-stone-900">We didn&apos;t find a match for this search yet</h3>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Save this search intent and we&apos;ll use it to improve underserved combinations like multi-pet homes,
          exotics, and specialist care needs.
        </p>

        <div className="mt-5 rounded-2xl border border-[#E8DDD0] bg-white/80 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            Your Search
          </div>
          <p className="mt-2 text-sm font-medium text-stone-900">{searchTerm}</p>
          <p className="mt-1 text-sm text-stone-500">{summaryLine}</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitState === 'submitting' || submitState === 'success'}
            className="rounded-full border border-[#3D5A45] bg-[#3D5A45] px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#324A39] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitState === 'submitting'
              ? 'Saving...'
              : submitState === 'success'
                ? 'Saved'
                : 'Save This Search'}
          </button>
          <p className="text-xs text-stone-500">This helps PawFinder understand demand in low-coverage areas.</p>
        </div>

        {submitState === 'success' ? (
          <p className="mt-4 text-sm font-medium text-[#3D5A45]">
            Thanks, your search intent has been saved for the team.
          </p>
        ) : null}

        {errorMessage ? <p className="mt-4 text-sm text-[#B14A2B]">{errorMessage}</p> : null}
      </div>
    </div>
  )
}
