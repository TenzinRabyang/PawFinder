import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import BrandLogo from '@/components/brand/BrandLogo'

export default async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <nav className="bg-white border-b border-stone-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-col justify-center gap-3 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <div className="flex">
            <Link href="/" className="flex items-center">
              <BrandLogo
                iconSize={30}
                priority
                gapClassName="gap-2"
                wordmarkClassName="text-xl font-bold text-[#20261F] font-sans sm:text-2xl"
              />
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            {user ? (
              <>
                <Link 
                  href="/business/dashboard" 
                  className="rounded-full px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
                >
                  Dashboard
                </Link>
                <form action="/auth/signout" method="post">
                  <button className="rounded-full px-3 py-2 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-700">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-full bg-[#829e8d] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#6c8676] sm:w-auto"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
