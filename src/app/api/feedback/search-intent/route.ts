import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/utils/supabase/admin'

const REQUEST_SCHEMA = z.object({
  search_term: z.string().trim().min(1).max(300),
  category: z.string().trim().max(64).nullable().optional(),
  species: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
  location: z.string().trim().max(160).nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const payload = REQUEST_SCHEMA.safeParse(body)

    if (!payload.success) {
      return NextResponse.json({ error: 'Invalid search intent payload.' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()
    const { error } = await supabaseAdmin.from('search_intent_feedback').insert({
      search_term: payload.data.search_term,
      category: payload.data.category || null,
      species: payload.data.species,
      location: payload.data.location || null,
    })

    if (error) {
      console.error('[search-intent-feedback] Failed to save search intent')
      return NextResponse.json(
        { error: 'We could not save your search intent just now. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch {
    console.error('[search-intent-feedback] Unexpected search intent error')
    return NextResponse.json(
      { error: 'We could not save your search intent just now. Please try again.' },
      { status: 500 }
    )
  }
}
