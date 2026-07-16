'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export type ProviderContactActionType = 'phone_click' | 'website_click' | 'booking_click'

type ActionTriggerToastProps = {
  providerId: string
  actionType: ProviderContactActionType | null
  visible: boolean
  onClose: () => void
}

type ToastState = 'prompt' | 'saving' | 'success'

const SUCCESS_MESSAGE_BY_RATING = {
  yes: 'Awesome! Thanks for letting us know. 🐾',
  no: 'Got it, thanks for helping us improve! ❤️',
} as const

export default function ActionTriggerToast({
  providerId,
  actionType,
  visible,
  onClose,
}: ActionTriggerToastProps) {
  const supabase = useMemo(() => createClient(), [])
  const [toastState, setToastState] = useState<ToastState>('prompt')
  const [selectedRating, setSelectedRating] = useState<'yes' | 'no' | null>(null)

  useEffect(() => {
    if (toastState !== 'success') return

    const timeoutId = window.setTimeout(() => {
      onClose()
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [onClose, toastState])

  const handleResponse = async (rating: 'yes' | 'no') => {
    if (!actionType || toastState === 'saving') return

    setSelectedRating(rating)
    setToastState('saving')

    try {
      const { error } = await supabase.from('user_feedback').insert({
        feedback_type: 'action_trigger',
        rating,
        metadata: {
          provider_id: providerId,
          action_type: actionType,
        },
      })

      if (error) {
        console.error('Failed to save action trigger feedback', error)
        onClose()
        return
      }

      setToastState('success')
    } catch (error) {
      console.error('Failed to save action trigger feedback', error)
      onClose()
    }
  }

  const successMessage = selectedRating ? SUCCESS_MESSAGE_BY_RATING[selectedRating] : ''

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 transition-all duration-300 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:px-0 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      }`}
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-sm rounded-[1.35rem] border border-[#E4DBCA] bg-[rgba(255,252,247,0.97)] p-4 text-[#2F312E] shadow-[0_22px_44px_-26px_rgba(32,38,31,0.42)] backdrop-blur">
        {toastState === 'success' ? (
          <p className="text-sm font-medium leading-6 text-[#4A5147]">{successMessage}</p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium leading-6 text-[#394136]">
              Did you get in touch with this provider?
            </p>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => void handleResponse('yes')}
                disabled={toastState === 'saving'}
                className="rounded-full border border-[#3D5A45] bg-[#3D5A45] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#324A39] disabled:cursor-wait disabled:opacity-70"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => void handleResponse('no')}
                disabled={toastState === 'saving'}
                className="rounded-full border border-[#D8C4A6] bg-[#FFF8ED] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#6A5121] transition hover:bg-[#FFF1D7] disabled:cursor-wait disabled:opacity-70"
              >
                No
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
