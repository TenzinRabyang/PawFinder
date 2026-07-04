'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type ClaimListingCardProps = {
  claimId: string
}

type TaggingResponse = {
  status: 'completed' | 'fetch_blocked' | 'failed' | 'skipped_low_content'
  message: string
}

export function ClaimListingCard({ claimId }: ClaimListingCardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [details, setDetails] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [claimResult, setClaimResult] = useState<TaggingResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadDetails = async () => {
      setLoadingDetails(true)
      setError(null)

      try {
        const response = await fetch(`/api/providers/${encodeURIComponent(claimId)}/live-details`, {
          signal: AbortSignal.timeout(15000),
        })
        const data = await response.json()

        if (!response.ok || data.error) {
          throw new Error(data.error || 'Failed to load business details')
        }

        if (!cancelled) {
          setDetails(data)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load business details')
        }
      } finally {
        if (!cancelled) {
          setLoadingDetails(false)
        }
      }
    }

    void loadDetails()

    return () => {
      cancelled = true
    }
  }, [claimId])

  const claimPayload = useMemo(() => {
    if (!details) return null

    return {
      google_place_id: claimId,
      name: details.name,
      address: details.formatted_address || '',
      website: details.website || '',
      phone: details.formatted_phone_number || '',
      googleTypes: Array.isArray(details.types) ? details.types : [],
    }
  }, [claimId, details])

  const handleClaim = async () => {
    if (!claimPayload) return

    setError(null)
    setClaimResult(null)

    try {
      const response = await fetch('/api/business/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claimPayload),
        signal: AbortSignal.timeout(15000),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to claim listing')
      }

      setClaimResult(data.tagging || { status: 'failed', message: 'Claim succeeded, but website analysis did not return a status.' })

      startTransition(() => {
        router.push('/business/dashboard')
        router.refresh()
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        setError("Claim succeeded or is still processing, but the page didn't get a quick response. Refresh the dashboard in a moment.")
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to claim listing')
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-stone-900">Claim This Listing</h1>
      <p className="mt-2 text-sm text-stone-600">
        Confirm ownership to unlock your business dashboard, AI website analysis, and manual reanalysis tools.
      </p>

      <div className="mt-6 rounded-xl border border-stone-100 bg-stone-50 p-5">
        {loadingDetails ? (
          <p className="text-sm text-stone-500">Loading business details...</p>
        ) : details ? (
          <>
            <h2 className="text-lg font-semibold text-stone-900">{details.name}</h2>
            <p className="mt-1 text-sm text-stone-600">{details.formatted_address}</p>
            {details.website && <p className="mt-2 text-sm text-stone-500">{details.website}</p>}
          </>
        ) : (
          <p className="text-sm text-stone-500">Business details could not be loaded.</p>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleClaim}
          disabled={!claimPayload || loadingDetails || isPending}
          className="rounded-full bg-[#829e8d] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#6c8676] disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isPending ? 'Claiming Listing...' : 'Claim Listing'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/search')}
          className="rounded-full border border-stone-200 px-5 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
        >
          Back to Search
        </button>
      </div>

      {claimResult && <p className="mt-4 text-sm font-medium text-[#6c8676]">{claimResult.message}</p>}
      {error && <p className="mt-4 text-sm font-medium text-[#c26046]">{error}</p>}
    </div>
  )
}
