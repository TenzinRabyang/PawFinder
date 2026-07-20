'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { isSupabasePublicEnvConfigured } from '@/utils/supabase/config'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const isAuthAvailable = isSupabasePublicEnvConfigured()

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAuthAvailable) {
      setError('Sign-in is temporarily unavailable because Supabase auth is not configured.')
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.refresh()
      router.push('/')
    }
  }

  const handleEmailSignup = async () => {
    if (!isAuthAvailable) {
      setError('Sign-up is temporarily unavailable because Supabase auth is not configured.')
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setError('Check your email for the confirmation link.')
    }
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    if (!isAuthAvailable) {
      setError('Google sign-in is temporarily unavailable because Supabase auth is not configured.')
      return
    }
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div className="mt-8 space-y-6">
      {!isAuthAvailable && (
        <div className="text-sm text-center p-3 bg-amber-50 text-amber-800 rounded-lg">
          Authentication is currently unavailable in this environment.
        </div>
      )}
      {error && (
        <div className="text-sm text-center p-3 bg-red-50 text-red-600 rounded-lg">
          {error}
        </div>
      )}
      <form className="space-y-4" onSubmit={handleEmailLogin}>
        <div>
          <label className="block text-sm font-medium text-stone-700">Email address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-sage-500 focus:outline-none focus:ring-sage-500 sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-stone-300 px-3 py-2 text-stone-900 focus:border-sage-500 focus:outline-none focus:ring-sage-500 sm:text-sm"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <button
            type="submit"
            disabled={loading || !isAuthAvailable}
            className="flex w-full justify-center rounded-full bg-[#829e8d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#6c8676] focus:outline-none focus:ring-2 focus:ring-[#829e8d] focus:ring-offset-2 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={handleEmailSignup}
            disabled={loading || !isAuthAvailable}
            className="flex w-full justify-center rounded-full bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-200 focus:ring-offset-2 disabled:opacity-50 transition-colors"
          >
            Sign Up
          </button>
        </div>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-stone-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-2 text-xs text-stone-500 sm:text-sm">Or continue with</span>
        </div>
      </div>

      <button
        onClick={handleGoogleLogin}
        disabled={!isAuthAvailable}
        className="flex w-full items-center justify-center gap-3 rounded-full border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-200 focus:ring-offset-2"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Sign in with Google
      </button>
    </div>
  )
}
