'use client'

import { useState } from 'react'

export default function AdminSeedPage() {
  const [postcode, setPostcode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ added: number; skipped: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSeed = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/seed/postcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcode })
      })
      const data = await res.json()
      
      if (!res.ok) throw new Error(data.error || 'Failed to seed')
      
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] py-12 px-4">
      <div className="mx-auto max-w-xl rounded-2xl border border-stone-100 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="mb-6 text-2xl font-bold text-stone-800 sm:text-3xl">Database Seeder</h1>
        <p className="text-stone-600 mb-8">
          Enter a UK postcode to automatically populate the database with local pet service pf_providers using Google Places and DeepSeek AI.
        </p>

        <form onSubmit={handleSeed} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700">Postcode</label>
            <input
              type="text"
              required
              placeholder="e.g. M1 1AA"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-stone-300 px-3 py-2.5 text-stone-900 focus:border-sage-500 focus:outline-none focus:ring-sage-500 sm:text-sm"
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="flex w-full justify-center rounded-full bg-[#829e8d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#6c8676] disabled:opacity-50"
          >
            {loading ? 'Seeding...' : 'Run Seeder'}
          </button>
        </form>

        {error && (
          <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 p-6 bg-stone-50 rounded-lg border border-stone-100">
            <h3 className="font-semibold text-stone-800 mb-4">Seeding Results</h3>
            <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
              <div className="bg-white p-3 rounded shadow-sm border border-stone-100">
                <div className="text-2xl font-bold text-green-600">{result.added}</div>
                <div className="text-xs text-stone-500 uppercase tracking-wide mt-1">Added</div>
              </div>
              <div className="bg-white p-3 rounded shadow-sm border border-stone-100">
                <div className="text-2xl font-bold text-stone-600">{result.skipped}</div>
                <div className="text-xs text-stone-500 uppercase tracking-wide mt-1">Skipped</div>
              </div>
              <div className="bg-white p-3 rounded shadow-sm border border-stone-100">
                <div className="text-2xl font-bold text-red-600">{result.failed}</div>
                <div className="text-xs text-stone-500 uppercase tracking-wide mt-1">Failed</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
