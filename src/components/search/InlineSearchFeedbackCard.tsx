'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type InlineSearchFeedbackCardProps = {
  searchQuery: string
  resultsCount: number
  sessionKey: string
}

type CardState = 'prompt' | 'saving' | 'submitted'

const SUCCESS_COPY = {
  yes: "Thanks! We're glad to hear it. 🐾",
  no: 'Thanks for the feedback, we are constantly working to improve our search! ❤️',
} as const

export default function InlineSearchFeedbackCard({
  searchQuery,
  resultsCount,
  sessionKey,
}: InlineSearchFeedbackCardProps) {
  const supabase = useMemo(() => createClient(), [])
  const [isHidden, setIsHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(sessionKey) === '1'
  })
  const [cardState, setCardState] = useState<CardState>('prompt')
  const [selectedRating, setSelectedRating] = useState<'yes' | 'no' | null>(null)

  const markSessionComplete = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sessionKey, '1')
    }
  }

  const handleDismiss = () => {
    markSessionComplete()
    setIsHidden(true)
  }

  const handleResponse = async (rating: 'yes' | 'no') => {
    if (cardState === 'saving') return

    setSelectedRating(rating)
    setCardState('saving')

    try {
      const { error } = await supabase.from('user_feedback').insert({
        feedback_type: 'search_relevance',
        rating,
        metadata: {
          search_query: searchQuery,
          results_count: resultsCount,
        },
      })

      if (error) {
        console.error('Failed to save inline search feedback', error)
        setCardState('prompt')
        setSelectedRating(null)
        return
      }

      markSessionComplete()
      setCardState('submitted')
    } catch (error) {
      console.error('Failed to save inline search feedback', error)
      setCardState('prompt')
      setSelectedRating(null)
    }
  }

  if (isHidden) return null

  return (
    <div className="rounded-2xl border border-[#E5DBCF] bg-[linear-gradient(180deg,#FFF8F1_0%,#FFFDFC_100%)] p-4 shadow-[0_18px_40px_-32px_rgba(32,38,31,0.34)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C5B4D]">
            Search Feedback
          </div>
          <div className="mt-2 overflow-hidden">
            <div
              className={`transition-all duration-300 ${
                cardState === 'submitted' ? 'translate-y-0 opacity-100' : 'translate-y-0 opacity-100'
              }`}
            >
              {cardState === 'submitted' ? (
                <p className="text-sm font-medium leading-6 text-[#4A5147]">
                  {selectedRating ? SUCCESS_COPY[selectedRating] : SUCCESS_COPY.no}
                </p>
              ) : (
                <>
                  <p className="text-base font-semibold text-[#20261F]">
                    Finding what you need in {searchQuery}?
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#6C7468]">
                    Your quick feedback helps us improve local search results.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleResponse('yes')}
                      disabled={cardState === 'saving'}
                      className="rounded-full border border-[#3D5A45] bg-[#3D5A45] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#324A39] disabled:cursor-wait disabled:opacity-70"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResponse('no')}
                      disabled={cardState === 'saving'}
                      className="rounded-full border border-[#D8C4A6] bg-[#FFF8ED] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#6A5121] transition hover:bg-[#FFF1D7] disabled:cursor-wait disabled:opacity-70"
                    >
                      No
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {cardState !== 'submitted' ? (
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#E6DECD] bg-white/90 text-[#7B8278] transition hover:border-[#D0C4AE] hover:text-[#20261F]"
            aria-label="Dismiss search feedback card"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
