import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { parseNeedsBasedSearchFilters } from '@/lib/provider-search-filters'
import {
  isValidUkPostcode,
  searchProvidersByPostcode,
} from '@/lib/provider-search-service'

async function isAdminForceRefreshAllowed(supabase: Awaited<ReturnType<typeof createClient>>) {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (adminEmails.length === 0) {
    return false
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return Boolean(user?.email && adminEmails.includes(user.email.toLowerCase()))
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const postcode = searchParams.get('postcode')
    const category = searchParams.get('category') || 'pet_care'
    const forceRefresh = searchParams.get('forceRefresh') === 'true'
    const searchFilters = parseNeedsBasedSearchFilters(searchParams)

    if (!postcode) {
      return NextResponse.json({ error: 'Postcode is required' }, { status: 400 })
    }

    if (!isValidUkPostcode(postcode)) {
      return NextResponse.json({ error: 'Please enter a full, valid UK postcode (e.g. S10 1BD)' }, { status: 400 })
    }
    const supabase = await createClient()

    if (forceRefresh) {
      const isAdmin = await isAdminForceRefreshAllowed(supabase)
      if (!isAdmin) {
        return NextResponse.json({ error: 'Force refresh is restricted to admin users' }, { status: 403 })
      }
    }

    const { providers, searchOrigin, cache } = await searchProvidersByPostcode({
      postcode,
      category,
      filters: searchFilters,
      forceRefresh,
    })
    const finalResults = [...providers]

    if (finalResults.length > 0) {
      finalResults[0] = {
        ...finalResults[0],
        is_featured_result: true,
      }
    }

    return NextResponse.json({
      pf_providers: finalResults,
      search_origin: searchOrigin,
      cache,
    })
  } catch (error) {
    console.error('[providers-search] Unexpected search route failure', error)
    return NextResponse.json(
      { error: 'Search is temporarily unavailable. Please try again shortly.' },
      { status: 500 }
    )
  }
}
