import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabasePublicEnv } from '@/utils/supabase/config'

function hasSupabaseAuthCookies(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) => name.startsWith('sb-'))
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })
  const { url, anonKey, isConfigured } = getSupabasePublicEnv()

  if (!isConfigured) {
    return supabaseResponse
  }

  // Skip auth refresh work for anonymous public traffic. This removes noisy
  // Supabase auth errors on routes where no session cookies are present.
  if (!hasSupabaseAuthCookies(request)) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  try {
    const { error } = await supabase.auth.getUser()
    if (error) {
      console.warn('[middleware] auth.getUser returned error', {
        path: request.nextUrl.pathname,
        message: error.message,
      })
    }
  } catch (error: unknown) {
    console.warn('[middleware] auth.getUser threw', {
      path: request.nextUrl.pathname,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/business/dashboard',
    '/business/dashboard/:path*',
  ],
}
