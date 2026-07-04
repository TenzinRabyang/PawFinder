'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function ReanalyzeButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleReanalyze = async () => {
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/business/reanalyze', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to re-run website analysis')
      }

      const tagging = data.tagging

      if (tagging?.status === 'completed') {
        setMessage(
          tagging.message ||
            `Website analysed across ${tagging.pages_analysed} page${tagging.pages_analysed === 1 ? '' : 's'}. Saved tags and booking information were refreshed successfully.`
        )
      } else if (tagging?.status === 'skipped_low_content' || tagging?.status === 'fetch_blocked' || tagging?.status === 'failed') {
        setError(tagging.message || 'Website analysis did not complete successfully.')
      } else {
        setMessage('Website analysis finished. Refreshing saved profile details now.')
      }

      startTransition(() => {
        router.refresh()
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        setError("We're still analysing this business — check back shortly.")
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to re-run website analysis')
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-stone-100 bg-stone-50 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-bold text-stone-900">AI Website Analysis</h3>
          <p className="mt-1 text-sm text-stone-600">
            Re-scan your website to refresh saved animals, services, breed coverage, and online booking details.
          </p>
          {isPending && (
            <div className="mt-3 rounded-full bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6c8676] shadow-sm">
              Analysing website content and saving updated tags and booking details...
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleReanalyze}
          disabled={isPending}
          className="rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-400"
        >
          {isPending ? 'Analysing Website...' : 'Re-analyse Website'}
        </button>
      </div>

      {message && <p className="mt-3 text-sm font-medium text-[#6c8676]">{message}</p>}
      {error && <p className="mt-3 text-sm font-medium text-[#c26046]">{error}</p>}
    </div>
  )
}
