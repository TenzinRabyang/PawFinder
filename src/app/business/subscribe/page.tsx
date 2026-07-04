'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

export default function SubscribePage() {
  const [loading, setLoading] = useState<string | null>(null)

  const handleSubscribe = async (tier: string) => {
    setLoading(tier)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier })
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Checkout failed')
      }
    } catch (err) {
      alert('Error creating checkout session')
    }
    setLoading(null)
  }

  const tiers = [
    {
      name: 'Free',
      price: '£0',
      description: 'Basic listing in the directory.',
      features: ['Basic contact info', 'Native temperament pf_reviews'],
      action: 'Current Plan',
      tier: 'free'
    },
    {
      name: 'Verified',
      price: '£15',
      period: '/mo',
      description: 'Stand out with a verified badge.',
      features: ['Verified checkmark', 'Higher search ranking', 'Upload custom photos'],
      action: 'Upgrade to Verified',
      tier: 'verified',
      popular: true
    },
    {
      name: 'Premium',
      price: '£30',
      period: '/mo',
      description: 'The ultimate presence with live Google data.',
      features: ['Live Google Photos', 'Live Google Rating', 'AI Review Summaries', 'Top search placement'],
      action: 'Upgrade to Premium',
      tier: 'premium'
    }
  ]

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-14 sm:py-20">
      <div className="max-w-7xl mx-auto text-center">
        <h1 className="mb-4 text-3xl font-extrabold tracking-tight text-stone-900 font-sans sm:text-4xl">
          Grow your pet business with PawFinder
        </h1>
        <p className="mx-auto mb-12 max-w-2xl text-base text-stone-600 sm:mb-16 sm:text-xl">
          Choose the plan that fits your needs. Get verified to build trust, or go premium to automatically sync your best Google content.
        </p>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 text-left md:grid-cols-3 md:gap-8">
          {tiers.map((t) => (
            <div key={t.name} className={`relative rounded-3xl border bg-white p-6 shadow-sm sm:p-8 ${t.popular ? 'border-[#829e8d] ring-1 ring-[#829e8d]' : 'border-stone-200'}`}>
              {t.popular && (
                <div className="absolute right-5 top-0 -translate-y-1/2 rounded-full bg-[#829e8d] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white sm:right-6 sm:text-xs">
                  Most Popular
                </div>
              )}
              <h3 className="text-2xl font-bold text-stone-900">{t.name}</h3>
              <div className="mt-4 flex items-baseline text-5xl font-extrabold text-stone-900">
                {t.price}
                {t.period && <span className="ml-1 text-xl font-medium text-stone-500">{t.period}</span>}
              </div>
              <p className="mt-4 text-stone-500">{t.description}</p>
              
              <ul className="mt-8 space-y-4">
                {t.features.map(f => (
                  <li key={f} className="flex items-start">
                    <Check className="h-5 w-5 text-[#829e8d] shrink-0 mr-3" />
                    <span className="text-stone-700">{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleSubscribe(t.tier)}
                disabled={t.tier === 'free' || loading !== null}
                className={`mt-8 w-full py-3 px-4 rounded-full font-semibold transition-colors ${
                  t.tier === 'free' 
                    ? 'bg-stone-100 text-stone-400 cursor-not-allowed' 
                    : t.popular 
                      ? 'bg-[#829e8d] text-white hover:bg-[#6c8676]' 
                      : 'bg-stone-800 text-white hover:bg-stone-700'
                }`}
              >
                {loading === t.tier ? 'Processing...' : t.action}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
