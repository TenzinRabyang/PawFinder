'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { X } from 'lucide-react'

export type ProviderContactActionType = 'phone_click' | 'website_click' | 'booking_click'

type ActionTriggerToastProps = {
  providerId: string
  actionType: ProviderContactActionType | null
  visible: boolean
  onClose: () => void
}

type ToastState = 'prompt' | 'saving' | 'collecting_details' | 'saving_details' | 'final'

const SUCCESS_MESSAGE_BY_RATING = {
  yes: 'Awesome! Thanks for letting us know. 🐾',
  no: 'Got it, thanks for helping us improve! ❤️',
} as const

const FINAL_SUCCESS_MESSAGE = 'Got it! Your entry is locked in. Good luck! 🐾'

export default function ActionTriggerToast({
  providerId,
  actionType,
  visible,
  onClose,
}: ActionTriggerToastProps) {
  const supabase = useMemo(() => createClient(), [])
  const [toastState, setToastState] = useState<ToastState>('prompt')
  const [selectedRating, setSelectedRating] = useState<'yes' | 'no' | null>(null)
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [email, setEmail] = useState('')
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    if (toastState !== 'final') return

    const timeoutId = window.setTimeout(() => {
      onClose()
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [onClose, toastState])

  const handleResponse = async (rating: 'yes' | 'no') => {
    if (!actionType || toastState === 'saving' || toastState === 'saving_details') return

    const generatedId = crypto.randomUUID()
    setSelectedRating(rating)
    setFeedbackId(generatedId)
    setToastState('saving')

    try {
      const { error } = await supabase
        .from('user_feedback')
        .insert({
          id: generatedId,
          feedback_type: 'action_trigger',
          rating,
          metadata: {
            provider_id: providerId,
            action_type: actionType,
          },
        })

      if (error) {
        console.error('Failed to save action trigger feedback')
        setFeedbackId(null)
        setSelectedRating(null)
        setToastState('prompt')
        return
      }

      setToastState('collecting_details')
    } catch {
      console.error('Failed to save action trigger feedback')
      setFeedbackId(null)
      setSelectedRating(null)
      setToastState('prompt')
    }
  }

  const handleSkip = () => {
    onClose()
  }

  const handleSubmitDetails = async () => {
    if (!feedbackId || toastState === 'saving_details') return

    setToastState('saving_details')

    try {
      const { error } = await supabase
        .from('user_feedback')
        .update({
          comment: comment.trim() || null,
          user_email: email.trim() || null,
        })
        .eq('id', feedbackId)

      if (error) {
        console.error('Failed to update action trigger feedback')
        setToastState('collecting_details')
        return
      }

      setToastState('final')
    } catch {
      console.error('Failed to update action trigger feedback')
      setToastState('collecting_details')
    }
  }

  const successMessage = selectedRating ? SUCCESS_MESSAGE_BY_RATING[selectedRating] : ''
  const isSaving = toastState === 'saving'
  const isSavingDetails = toastState === 'saving_details'
  const canSubmitDetails = Boolean(comment.trim() || email.trim())
  const shouldRenderToast = visible && !isDismissed

  return (
    <div
      className={`pointer-events-none fixed bottom-4 left-4 right-20 z-50 flex justify-start transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:right-auto md:max-w-md ${
        shouldRenderToast ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-8 scale-95 opacity-0'
      }`}
      aria-live="polite"
    >
      <div className="pointer-events-auto relative w-full overflow-hidden rounded-[1.35rem] border border-[#E4DBCA] bg-[rgba(255,252,247,0.97)] p-4 pr-11 text-[#2F312E] shadow-[0_22px_44px_-26px_rgba(32,38,31,0.42)] backdrop-blur">
        <div className="absolute inset-x-0 top-0 h-1 bg-[#B14A2B]" />
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="absolute right-2 top-2 text-gray-400 transition hover:text-gray-600"
          aria-label="Close feedback toast"
        >
          <X className="h-4 w-4" />
        </button>
        {toastState === 'prompt' || toastState === 'saving' ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#B14A2B] shadow-[0_0_0_6px_rgba(177,74,43,0.12)] animate-pulse" />
              <p className="text-sm font-medium leading-6 text-[#394136]">
                Did you get in touch with this provider?
              </p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
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
          </div>
        ) : toastState === 'final' ? (
          <div className="flex items-start gap-3">
            <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#B14A2B] shadow-[0_0_0_6px_rgba(177,74,43,0.12)]" />
            <p className="text-sm font-medium leading-6 text-[#4A5147]">{FINAL_SUCCESS_MESSAGE}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#B14A2B] shadow-[0_0_0_6px_rgba(177,74,43,0.12)] animate-pulse" />
              <p className="text-sm font-medium leading-6 text-[#4A5147]">{successMessage}</p>
            </div>
            <div>
              <label
                htmlFor="action-trigger-note"
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#7B8278]"
              >
                Any tips or features you&apos;d like to see? (Optional)
              </label>
              <textarea
                id="action-trigger-note"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="Share anything that would improve PawFinder for you..."
                className="mt-2 w-full rounded-[1rem] border border-[#DCD3BE] bg-white/90 px-3 py-2.5 text-sm text-[#20261F] outline-none transition placeholder:text-[#8D938A] focus:border-[#B14A2B]"
              />
            </div>
            <div>
              <label
                htmlFor="action-trigger-email"
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#7B8278]"
              >
                Your email (To enter the £50 Pets at Home raffle)
              </label>
              <input
                id="action-trigger-email"
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
        )}
      </div>
    </div>
  )
}
