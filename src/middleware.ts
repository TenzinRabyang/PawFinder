import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const getErrorDetails = (error: unknown) => {
    if (error instanceof Error) {
      return {
        errorMessage: error.message,
        errorStack: error.stack ?? null,
        errorName: error.name,
      }
    }

    return {
      errorMessage: String(error),
      errorStack: null,
      errorName: null,
    }
  }

  const requestMeta = {
    url: request.url,
    pathname: request.nextUrl.pathname,
    method: request.method,
    host: request.headers.get('host'),
    xForwardedHost: request.headers.get('x-forwarded-host'),
    xForwardedProto: request.headers.get('x-forwarded-proto'),
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  }
  console.log('[middleware] start', requestMeta)

  if (request.nextUrl.pathname.startsWith('/_next/webpack-hmr')) {
    console.log('[middleware] webpack-hmr request', requestMeta)
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
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
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      console.error('[middleware] auth.getUser returned error', {
        ...requestMeta,
        errorMessage: error.message,
        errorName: error.name,
        errorStatus: 'status' in error ? error.status : null,
      })
    } else {
      console.log('[middleware] auth.getUser ok', {
        ...requestMeta,
        userPresent: Boolean(data?.user),
      })
    }
  } catch (error: unknown) {
    const errorDetails = getErrorDetails(error)
    console.error('[middleware] auth.getUser threw', {
      ...requestMeta,
      ...errorDetails,
    })
    throw error
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
