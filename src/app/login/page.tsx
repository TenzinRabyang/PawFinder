import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/')
  }
  
  const resolvedSearchParams = await searchParams

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FAF9F6] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-stone-100 bg-white p-6 shadow-sm sm:space-y-8 sm:p-8">
        <div>
          <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-stone-800 font-sans sm:mt-6 sm:text-3xl">
            Sign in to PawFinder
          </h2>
          <p className="mt-2 text-center text-sm text-stone-600">
            Join the community of pet owners and businesses
          </p>
        </div>
        
        {resolvedSearchParams?.error && (
          <div className="bg-red-50 text-red-500 p-3 rounded-md text-sm text-center">
            {resolvedSearchParams.error}
          </div>
        )}

        <LoginForm />
      </div>
    </div>
  )
}
