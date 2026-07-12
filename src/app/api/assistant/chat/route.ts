import { NextResponse } from 'next/server'

import { createClient } from '@/utils/supabase/server'

type AssistantChatMessage = {
  role: 'assistant' | 'user'
  content: string
}

type SearchProvider = {
  id: string
  google_place_id?: string
  name?: string
  category?: string
  address?: string
  google_rating?: {
    score?: number
    count?: number
    source?: string
  } | null
  breeds_specialised?: string[]
  breeds_general_inferred?: string[]
}

type ProviderRecord = {
  id: string
  google_place_id: string | null
  category: string | null
  review_summary: string | null
  breeds_specialised: string[] | null
  breeds_general_inferred: string[] | null
}

type AssistantProvider = {
  id: string
  google_place_id: string | null
  name: string
  category: string | null
  address: string | null
  google_rating: number | null
  total_review_count: number | null
  review_summary: string | null
  breed_tags: string[]
}

const MAX_MESSAGE_COUNT = 12
const MAX_MESSAGE_LENGTH = 1200

function normalizePostcode(postcode: string) {
  return postcode.trim().toUpperCase().replace(/\s+/g, '')
}

function isValidPostcode(postcode: string) {
  return /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i.test(postcode.trim())
}

function formatCategoryLabel(value: string | null | undefined) {
  if (!value) return null

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function dedupeValues(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])]
}

function normalizeMessages(input: unknown): AssistantChatMessage[] {
  if (!Array.isArray(input)) return []

  return input
    .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === 'object')
    .map((message) => ({
      role: (message.role === 'assistant' ? 'assistant' : 'user') as AssistantChatMessage['role'],
      content: typeof message.content === 'string' ? message.content.trim() : '',
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_MESSAGE_COUNT)
    .map((message) => ({
      ...message,
      content: message.content.slice(0, MAX_MESSAGE_LENGTH),
    }))
}

async function fetchNearbyProviders(request: Request, postcode: string) {
  const searchUrl = new URL('/api/providers/search', request.url)
  searchUrl.searchParams.set('postcode', postcode)

  const searchResponse = await fetch(searchUrl.toString(), {
    method: 'GET',
    headers: {
      cookie: request.headers.get('cookie') || '',
    },
    cache: 'no-store',
  })

  const searchPayload = await searchResponse.json()

  if (!searchResponse.ok) {
    const errorMessage =
      searchPayload && typeof searchPayload.error === 'string'
        ? searchPayload.error
        : 'Failed to fetch nearby providers'
    throw new Error(errorMessage)
  }

  const rawProviders = Array.isArray(searchPayload.pf_providers)
    ? (searchPayload.pf_providers as SearchProvider[]).slice(0, 5)
    : []

  if (rawProviders.length === 0) {
    return [] as AssistantProvider[]
  }

  const supabase = await createClient()
  const internalIds = dedupeValues(rawProviders.map((provider) => provider.id))
  const googlePlaceIds = dedupeValues(rawProviders.map((provider) => provider.google_place_id))

  const providerRecords: ProviderRecord[] = []

  if (internalIds.length > 0) {
    const { data } = await supabase
      .from('pf_providers')
      .select('id, google_place_id, category, review_summary, breeds_specialised, breeds_general_inferred')
      .in('id', internalIds)

    providerRecords.push(...((data || []) as ProviderRecord[]))
  }

  if (googlePlaceIds.length > 0) {
    const { data } = await supabase
      .from('pf_providers')
      .select('id, google_place_id, category, review_summary, breeds_specialised, breeds_general_inferred')
      .in('google_place_id', googlePlaceIds)

    providerRecords.push(...((data || []) as ProviderRecord[]))
  }

  const byInternalId = new Map<string, ProviderRecord>()
  const byPlaceId = new Map<string, ProviderRecord>()

  for (const record of providerRecords) {
    if (!byInternalId.has(record.id)) {
      byInternalId.set(record.id, record)
    }

    if (record.google_place_id && !byPlaceId.has(record.google_place_id)) {
      byPlaceId.set(record.google_place_id, record)
    }
  }

  return rawProviders.map((provider) => {
    const dbMatch =
      (provider.google_place_id ? byPlaceId.get(provider.google_place_id) : null) ||
      byInternalId.get(provider.id) ||
      null
    const breedTags = dedupeValues([
      ...(dbMatch?.breeds_specialised || provider.breeds_specialised || []),
      ...(dbMatch?.breeds_general_inferred || provider.breeds_general_inferred || []),
    ])

    return {
      id: provider.id,
      google_place_id: provider.google_place_id || null,
      name: provider.name || 'Unknown business',
      category: formatCategoryLabel(dbMatch?.category || provider.category),
      address: provider.address || null,
      google_rating:
        typeof provider.google_rating?.score === 'number' ? provider.google_rating.score : null,
      total_review_count:
        typeof provider.google_rating?.count === 'number' ? provider.google_rating.count : null,
      review_summary: dbMatch?.review_summary || null,
      breed_tags: breedTags,
    } satisfies AssistantProvider
  })
}

function buildProviderContext(providers: AssistantProvider[]) {
  return providers
    .map(
      (provider, index) => `Business ${index + 1}
Name: ${provider.name}
Category: ${provider.category || 'Unknown'}
Address: ${provider.address || 'Unknown'}
Google Rating: ${provider.google_rating ?? 'Unknown'}
Total Review Count: ${provider.total_review_count ?? 'Unknown'}
review_summary: ${provider.review_summary || '[blank]'}
breed_tags: ${provider.breed_tags.length > 0 ? provider.breed_tags.join(', ') : '[blank]'}`
    )
    .join('\n\n')
}

async function getAssistantReply(messages: AssistantChatMessage[], postcode: string, providers: AssistantProvider[]) {
  const key = process.env.DEEPSEEK_API_KEY

  if (!key) {
    throw new Error('DeepSeek API key missing')
  }

  const systemInstructions = [
    `Role: "You are PawFinder's brutally honest pet care advisor."`,
    `Goal: "Match the user's specific request against the provided list of 5 nearby businesses and recommend the top 3."`,
    `Rule (Cold-Start Transparency): "If a business has a pre-baked 'review_summary' or breed tags, use that data to prove specific fit. If those fields are blank, look at its general Google rating and total review count. Explicitly tell the user: 'This business is new to PawFinder so our community hasn't logged specific breed feedback yet, but they hold a [Rating]-star score on Google across [Count] reviews, making them a great option to look into.'"`,
    `Rule (Honest Failure): "If absolutely none of the 5 options match what the user is looking for, tell them completely honestly that no perfect matches exist in this postcode, explain what is missing, and suggest the closest general alternative."`,
    'Use only the businesses and facts provided by PawFinder.',
    'Do not invent breed feedback, review summaries, facilities, or specialties.',
    'If a provider has review_summary or breed_tags, use them as your strongest proof of fit.',
    'When you use the cold-start transparency line, replace [Rating] and [Count] with the actual values from the business data.',
    'Keep the answer practical and direct. Recommend up to 3 businesses in rank order with clear reasons.',
  ].join('\n')

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: systemInstructions,
        },
        {
          role: 'system',
          content: `Postcode: ${postcode}\nNearby businesses:\n${buildProviderContext(providers)}`,
        },
        ...messages,
      ],
    }),
  })

  const rawBody = await response.text()

  if (!response.ok) {
    throw new Error(`DeepSeek request failed: ${rawBody}`)
  }

  const data = JSON.parse(rawBody)
  const reply = data?.choices?.[0]?.message?.content

  if (typeof reply !== 'string' || reply.trim().length === 0) {
    throw new Error('DeepSeek returned an empty response')
  }

  return reply.trim()
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const messages = normalizeMessages(body?.messages)
    const postcode =
      typeof body?.postcode === 'string' && body.postcode.trim().length > 0
        ? normalizePostcode(body.postcode)
        : null

    if (messages.length === 0) {
      return NextResponse.json({ error: 'At least one user message is required' }, { status: 400 })
    }

    if (postcode && !isValidPostcode(postcode)) {
      return NextResponse.json(
        { error: 'Please enter a full, valid UK postcode (e.g. S10 1BD)' },
        { status: 400 }
      )
    }

    if (!postcode) {
      return NextResponse.json({
        reply:
          'I can help compare nearby pet-care options, but I need a full postcode first. Search with a postcode and ask again, and I’ll rank the closest businesses for your needs.',
        providers: [],
      })
    }

    const providers = await fetchNearbyProviders(request, postcode)

    if (providers.length === 0) {
      return NextResponse.json({
        reply:
          `I couldn't find any nearby PawFinder providers to compare in ${postcode} yet. Try a nearby postcode or broaden the type of care you're looking for.`,
        providers: [],
      })
    }

    const reply = await getAssistantReply(messages, postcode, providers)

    return NextResponse.json({
      reply,
      providers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Assistant chat failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
