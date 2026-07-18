'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type InlineSearchFeedbackCardProps = {
  searchQuery: string
  resultsCount: number
  sessionKey: string
}

type CardState = 'prompt' | 'saving' | 'collecting_details' | 'saving_details' | 'final'

const SUCCESS_COPY = {
  yes: "Thanks! We're glad to hear it. 🐾",
  no: 'Thanks for the feedback, we are constantly working to improve our search! ❤️',
} as const

const FINAL_SUCCESS_MESSAGE = 'Got it! Your entry is locked in. Good luck! 🐾'

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
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (cardState !== 'final') return

    const timeoutId = window.setTimeout(() => {
      setIsHidden(true)
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [cardState])

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
      const { data, error } = await supabase
        .from('user_feedback')
        .insert({
          feedback_type: 'search_relevance',
          rating,
          metadata: {
            search_query: searchQuery,
            results_count: resultsCount,
          },
        })
        .select('id')
        .single()

      if (error) {
        console.error('Failed to save inline search feedback', error)
        setCardState('prompt')
        setSelectedRating(null)
        return
      }

      markSessionComplete()
      setFeedbackId(data?.id ?? null)
      setCardState('collecting_details')
    } catch (error) {
      console.error('Failed to save inline search feedback', error)
      setCardState('prompt')
      setSelectedRating(null)
    }
  }

  const handleSkip = () => {
    markSessionComplete()
    setIsHidden(true)
  }

  const handleSubmitDetails = async () => {
    if (!feedbackId || cardState === 'saving_details') return

    setCardState('saving_details')

    try {
      const { error } = await supabase
        .from('user_feedback')
        .update({
          comment: comment.trim() || null,
          user_email: email.trim() || null,
        })
        .eq('id', feedbackId)

      if (error) {
        console.error('Failed to update inline search feedback', error)
        setCardState('collecting_details')
        return
      }

      setCardState('final')
    } catch (error) {
      console.error('Failed to update inline search feedback', error)
      setCardState('collecting_details')
    }
  }

  if (isHidden) return null

  const isSaving = cardState === 'saving'
  const isSavingDetails = cardState === 'saving_details'
  const canSubmitDetails = Boolean(comment.trim() || email.trim())

  return (
    <div className="rounded-2xl border border-[#E5DBCF] bg-[linear-gradient(180deg,#FFF8F1_0%,#FFFDFC_100%)] p-4 shadow-[0_18px_40px_-32px_rgba(32,38,31,0.34)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8C5B4D]">
            Search Feedback
          </div>
          <div className="mt-2 overflow-hidden">
            <div className="transition-all duration-300 translate-y-0 opacity-100">
              {cardState === 'final' ? (
                <p className="text-sm font-medium leading-6 text-[#4A5147]">
                  {FINAL_SUCCESS_MESSAGE}
                </p>
              ) : cardState === 'collecting_details' || cardState === 'saving_details' ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium leading-6 text-[#4A5147]">
                    {selectedRating ? SUCCESS_COPY[selectedRating] : SUCCESS_COPY.no}
                  </p>
                  <div>
                    <label
                      htmlFor={`search-feedback-note-${sessionKey}`}
                      className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#7B8278]"
                    >
                      Any tips or features you&apos;d like to see? (Optional)
                    </label>
                    <textarea
                      id={`search-feedback-note-${sessionKey}`}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={3}
                      placeholder="Tell us how search could work better for you..."
                      className="mt-2 w-full rounded-[1rem] border border-[#DCD3BE] bg-white/90 px-3 py-2.5 text-sm text-[#20261F] outline-none transition placeholder:text-[#8D938A] focus:border-[#B14A2B]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`search-feedback-email-${sessionKey}`}
                      className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#7B8278]"
                    >
                      Your email (To enter the £50 Pets at Home raffle)
                    </label>
                    <input
                      id={`search-feedback-email-${sessionKey}`}
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      className="mt-2 w-full rounded-[1rem] border border-[#DCD3BE] bg-white/90 px-3 py-2.5 text-sm text-[#20261F] outline-none transition placeholder:text-[#8D938A] focus:border-[#B14A2B]"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void handleSubmitDetails()}
                      disabled={!canSubmitDetails || isSavingDetails}
                      className="rounded-full border border-[#3D5A45] bg-[#3D5A45] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#324A39] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Submit Note
                    </button>
                    <button
                      type="button"
                      onClick={handleSkip}
                      disabled={isSavingDetails}
                      className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7B8278] transition hover:text-[#20261F] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Skip
                    </button>
                  </div>
                </div>
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
                      disabled={isSaving}
                      className="rounded-full border border-[#3D5A45] bg-[#3D5A45] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#324A39] disabled:cursor-wait disabled:opacity-70"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResponse('no')}
                      disabled={isSaving}
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

        {cardState === 'prompt' || cardState === 'saving' ? (
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
