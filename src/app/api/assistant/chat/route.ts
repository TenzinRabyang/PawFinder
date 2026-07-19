import { NextResponse } from 'next/server'

import { createAdminClient } from '@/utils/supabase/admin'

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
  distance_miles?: number | null
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
  distance_miles: number | null
  google_rating: number | null
  total_review_count: number | null
  review_summary: string | null
  breed_tags: string[]
}

type LiveDetailsResponse = {
  place_id?: string
  name?: string
  formatted_address?: string
  formatted_phone_number?: string
  website?: string
  types?: string[]
  photos?: Array<Record<string, unknown>>
  ai_summary?: string | null
}

type AssistantLocationContext = {
  postcode: string | null
  location: string | null
  lat: number | null
  lng: number | null
}

const MAX_MESSAGE_COUNT = 12
const MAX_MESSAGE_LENGTH = 1000
const RAPID_ENRICHMENT_TIMEOUT_MS = 4000
const SAFE_ASSISTANT_ERROR =
  'Our assistant is currently taking a quick nap. Please try again in a moment!'
const OFF_TOPIC_REJECTION_MESSAGE =
  'I am your PawFinder assistant and can only help with pet care queries and local UK business matching. How can I help you find a pet service today?'
const OBVIOUS_PROGRAMMATIC_PATTERNS = [
  /\bfunction\s*\(/i,
  /\bimport\s+react\b/i,
  /\bwrite(?:\s+me)?\s+a\s+python\s+script\b/i,
  /\bconsole\.log\b/i,
  /\bfrom\s+['"]react['"]/i,
]

class AssistantRouteError extends Error {
  status: number
  exposeMessage: boolean

  constructor(message: string, status = 500, exposeMessage = false) {
    super(message)
    this.status = status
    this.exposeMessage = exposeMessage
  }
}

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

function validateIncomingMessages(input: unknown) {
  if (!Array.isArray(input)) {
    throw new AssistantRouteError('Messages must be provided as an array.', 400, true)
  }

  if (input.length > MAX_MESSAGE_COUNT) {
    throw new AssistantRouteError(
      `Message history cannot exceed ${MAX_MESSAGE_COUNT} items.`,
      400,
      true
    )
  }

  for (const message of input) {
    if (!message || typeof message !== 'object') {
      throw new AssistantRouteError('Each message must be an object.', 400, true)
    }

    const role = (message as { role?: unknown }).role
    const content = typeof (message as { content?: unknown }).content === 'string'
      ? (message as { content: string }).content
      : null

    if (content === null) {
      throw new AssistantRouteError('Each message must include text content.', 400, true)
    }

    if (role === 'user' && content.length > MAX_MESSAGE_LENGTH) {
      throw new AssistantRouteError(
        `Messages cannot exceed ${MAX_MESSAGE_LENGTH} characters.`,
        400,
        true
      )
    }

    if (OBVIOUS_PROGRAMMATIC_PATTERNS.some((pattern) => pattern.test(content))) {
      throw new AssistantRouteError(OFF_TOPIC_REJECTION_MESSAGE, 400, true)
    }
  }
}

async function fetchNearbyProviders(request: Request, postcode: string) {
  const searchUrl = new URL('/api/providers/search', request.url)
  searchUrl.searchParams.set('postcode', postcode)

  return fetchProvidersFromSearchEndpoint(request, searchUrl)
}

async function fetchNearbyProvidersByLocation(
  request: Request,
  location: string,
  lat: number,
  lng: number
) {
  const searchUrl = new URL('/api/providers/search-by-location', request.url)
  searchUrl.searchParams.set('location', location)
  searchUrl.searchParams.set('lat', String(lat))
  searchUrl.searchParams.set('lng', String(lng))

  return fetchProvidersFromSearchEndpoint(request, searchUrl)
}

async function fetchProvidersFromSearchEndpoint(request: Request, searchUrl: URL) {
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

  const supabase = createAdminClient()
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
      distance_miles: typeof provider.distance_miles === 'number' ? provider.distance_miles : null,
      google_rating:
        typeof provider.google_rating?.score === 'number' ? provider.google_rating.score : null,
      total_review_count:
        typeof provider.google_rating?.count === 'number' ? provider.google_rating.count : null,
      review_summary: dbMatch?.review_summary || null,
      breed_tags: breedTags,
    } satisfies AssistantProvider
  })
}

function buildLiveDetailsUrl(request: Request, placeId: string) {
  const liveDetailsUrl = new URL(`/api/providers/${encodeURIComponent(placeId)}/live-details`, request.url)
  liveDetailsUrl.searchParams.set('include_ai_summary', '1')
  return liveDetailsUrl
}

async function fetchLiveDetails(
  request: Request,
  placeId: string,
  timeoutMs?: number
): Promise<LiveDetailsResponse> {
  const liveDetailsResponse = await fetch(buildLiveDetailsUrl(request, placeId).toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      cookie: request.headers.get('cookie') || '',
    },
    signal: typeof timeoutMs === 'number' ? AbortSignal.timeout(timeoutMs) : undefined,
  })

  if (!liveDetailsResponse.ok) {
    throw new Error(`live-details returned ${liveDetailsResponse.status}`)
  }

  return (await liveDetailsResponse.json()) as LiveDetailsResponse
}

async function triggerEnsureTags(
  request: Request,
  provider: AssistantProvider,
  placeId: string,
  liveDetails: LiveDetailsResponse | null,
  timeoutMs?: number
) {
  const ensureTagsUrl = new URL(`/api/providers/${encodeURIComponent(placeId)}/ensure-tags`, request.url)
  const ensureTagsResponse = await fetch(ensureTagsUrl.toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      cookie: request.headers.get('cookie') || '',
    },
    signal: typeof timeoutMs === 'number' ? AbortSignal.timeout(timeoutMs) : undefined,
    body: JSON.stringify({
      name: liveDetails?.name || provider.name,
      address: liveDetails?.formatted_address || provider.address,
      category: provider.category?.toLowerCase().replace(/\s+/g, '_') || undefined,
      website: liveDetails?.website,
      phone: liveDetails?.formatted_phone_number,
      googleTypes: Array.isArray(liveDetails?.types) ? liveDetails.types : [],
      live_place_details: liveDetails
        ? {
            place_id: liveDetails.place_id || placeId,
            name: liveDetails.name,
            formatted_address: liveDetails.formatted_address,
            formatted_phone_number: liveDetails.formatted_phone_number,
            website: liveDetails.website,
            types: liveDetails.types,
            photos: liveDetails.photos,
          }
        : undefined,
    }),
  })

  if (!ensureTagsResponse.ok) {
    const responseText = await ensureTagsResponse.text().catch(() => '')
    throw new Error(`ensure-tags returned ${ensureTagsResponse.status}: ${responseText}`)
  }
}

async function persistReviewSummary(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  placeId: string,
  summary: string
) {
  const { error: summaryUpdateError } = await supabaseAdmin
    .from('pf_providers')
    .update({
      review_summary: summary,
      review_summary_updated_at: new Date().toISOString(),
    })
    .eq('google_place_id', placeId)

  if (summaryUpdateError) {
    throw summaryUpdateError
  }
}

function kickoffBackgroundEnrichment(
  request: Request,
  provider: AssistantProvider,
  placeId: string,
  options: {
    needsReviewSummary: boolean
    needsBreedTags: boolean
  }
) {
  const supabaseAdmin = createAdminClient()

  void (async () => {
    let liveDetails: LiveDetailsResponse | null = null

    await Promise.allSettled([
      options.needsReviewSummary || options.needsBreedTags
        ? (async () => {
            try {
              liveDetails = await fetchLiveDetails(request, placeId)
              const aiSummary =
                typeof liveDetails.ai_summary === 'string' && liveDetails.ai_summary.trim()
                  ? liveDetails.ai_summary.trim()
                  : null

              if (options.needsReviewSummary && aiSummary) {
                await persistReviewSummary(
                  supabaseAdmin,
                  liveDetails.place_id || provider.google_place_id || placeId,
                  aiSummary
                )
              }
            } catch {
              console.warn('[assistant-chat] background live-details enrichment failed')
            }
          })()
        : Promise.resolve(),
      options.needsBreedTags
        ? (async () => {
            try {
              await triggerEnsureTags(request, provider, placeId, liveDetails)
            } catch {
              console.warn('[assistant-chat] background ensure-tags enrichment failed')
            }
          })()
        : Promise.resolve(),
    ])
  })()
}

async function enrichProviderIfNeeded(request: Request, provider: AssistantProvider) {
  const needsReviewSummary = !provider.review_summary?.trim()
  const needsBreedTags = provider.breed_tags.length === 0

  if (!needsReviewSummary && !needsBreedTags) {
    return provider
  }

  const placeId = provider.google_place_id || provider.id

  if (!placeId) {
    return provider
  }

  const supabaseAdmin = createAdminClient()
  let liveDetails: LiveDetailsResponse | null = null
  let aiSummary = provider.review_summary
  let shouldContinueInBackground = false

  try {
    await Promise.all([
      needsReviewSummary || needsBreedTags
        ? fetchLiveDetails(request, placeId, RAPID_ENRICHMENT_TIMEOUT_MS).then((payload) => {
            liveDetails = payload
            aiSummary =
              typeof payload.ai_summary === 'string' && payload.ai_summary.trim()
                ? payload.ai_summary.trim()
                : aiSummary
          })
        : Promise.resolve(),
      needsBreedTags
        ? triggerEnsureTags(request, provider, placeId, null, RAPID_ENRICHMENT_TIMEOUT_MS)
        : Promise.resolve(),
    ])
  } catch {
    shouldContinueInBackground = true
    console.warn('[assistant-chat] rapid provider enrichment fell back to basic details')
  }

  try {
    if (needsReviewSummary && aiSummary?.trim()) {
      const resolvedLiveDetails = liveDetails as LiveDetailsResponse | null
      const summaryTargetPlaceId =
        (resolvedLiveDetails &&
          typeof resolvedLiveDetails.place_id === 'string' &&
          resolvedLiveDetails.place_id) ||
        provider.google_place_id ||
        placeId

      await persistReviewSummary(
        supabaseAdmin,
        summaryTargetPlaceId,
        aiSummary.trim()
      )
    }
  } catch {
    console.warn('[assistant-chat] provider enrichment persistence failed')
  }

  if (shouldContinueInBackground) {
    kickoffBackgroundEnrichment(request, provider, placeId, {
      needsReviewSummary,
      needsBreedTags,
    })
  }

  const refreshedPlaceId =
    ((liveDetails as LiveDetailsResponse | null)?.place_id &&
    typeof (liveDetails as LiveDetailsResponse | null)?.place_id === 'string'
      ? (liveDetails as LiveDetailsResponse | null)?.place_id
      : null) ||
    provider.google_place_id ||
    placeId

  try {
    const { data: refreshedProvider } = await supabaseAdmin
      .from('pf_providers')
      .select('google_place_id, category, review_summary, breeds_specialised, breeds_general_inferred')
      .eq('google_place_id', refreshedPlaceId)
      .maybeSingle()

    const refreshedBreedTags = refreshedProvider
      ? dedupeValues([
          ...(refreshedProvider.breeds_specialised || []),
          ...(refreshedProvider.breeds_general_inferred || []),
        ])
      : provider.breed_tags

    return {
      ...provider,
      google_place_id: refreshedPlaceId,
      category: formatCategoryLabel(refreshedProvider?.category || provider.category),
      review_summary:
        refreshedProvider?.review_summary?.trim() || aiSummary?.trim() || provider.review_summary,
      breed_tags: refreshedBreedTags,
    } satisfies AssistantProvider
  } catch {
    console.warn('[assistant-chat] provider enrichment refresh failed')

    return {
      ...provider,
      google_place_id: refreshedPlaceId,
      review_summary: aiSummary?.trim() || provider.review_summary,
    }
  }
}

async function enrichProvidersIfNeeded(request: Request, providers: AssistantProvider[]) {
  return Promise.all(providers.map((provider) => enrichProviderIfNeeded(request, provider)))
}

function buildProviderContext(providers: AssistantProvider[]) {
  return providers
    .map(
      (provider, index) => `Business ${index + 1}
Provider ID: ${provider.id}
Name: ${provider.name}
Category: ${provider.category || 'Unknown'}
Address: ${provider.address || 'Unknown'}
Distance Miles: ${provider.distance_miles ?? 'Unknown'}
Google Rating: ${provider.google_rating ?? 'Unknown'}
Total Review Count: ${provider.total_review_count ?? 'Unknown'}
review_summary: ${provider.review_summary || '[blank]'}
breed_tags: ${provider.breed_tags.length > 0 ? provider.breed_tags.join(', ') : '[blank]'}`
    )
    .join('\n\n')
}

async function getAssistantReply(
  messages: AssistantChatMessage[],
  locationContext: AssistantLocationContext,
  providers: AssistantProvider[]
) {
  const key = process.env.DEEPSEEK_API_KEY

  if (!key) {
    throw new Error('DeepSeek API key missing')
  }

  const hasLocationContext = Boolean(
    locationContext.postcode ||
      (locationContext.location && locationContext.lat !== null && locationContext.lng !== null)
  )
  const sharedFormattingRules = [
    'You are a precise, friendly local pet care scout for PawFinder. Your responses must be clean, highly structured, and optimized for quick mobile reading.',
    'NEVER output dense blocks or long paragraphs of text.',
    'Always use bold text for business names, ratings, and distances whenever those values are present in your answer.',
    'Use clean, bulleted lists or short lines with horizontal line breaks/spacing to separate distinct recommendations.',
    "Keep descriptions short and strictly focused on the user's direct intent (e.g., name, rating, address, distance, and a 1-sentence highlight).",
    'Use markdown only for bullets, bold text, and --- separators.',
    'Never invent missing facts. If a rating or distance is unavailable, omit it instead of guessing.',
  ]
  const systemInstructions = hasLocationContext
    ? [
        ...sharedFormattingRules,
        `Role: "You are ranking PawFinder's already-fetched local pet-care providers for the user's request."`,
        `Goal: "Match the user's specific request against the provided list of nearby businesses and recommend the top 3."`,
        `Interpretation Rule: "On PawFinder, requests such as 'find groomers near me', 'top dog walkers', 'highest-rated boarders', 'closest groomer', 'vet near me', or similar short category queries are valid pet-care directory searches. Treat them as requests to compare nearby pet-care providers, not as off-topic prompts."`,
        `Execution Rule: "If location context and nearby businesses are provided in the system context, you MUST use that nearby business list to answer the user. Do not ask for location again, do not refuse, and do not return the generic PawFinder safety sentence unless the user is truly asking for a non-pet unrelated task."`,
        `Rule (Cold-Start Transparency): "If a business has a pre-baked 'review_summary' or breed tags, use that data to prove specific fit. If those fields are blank, look at its general Google rating and total review count. Explicitly say that PawFinder does not yet have detailed community feedback for that business, then use the available Google rating evidence honestly."`,
        `Rule (Honest Failure): "If absolutely none of the options are a clean match, say so honestly, explain what is missing in 1 short line, and then offer the closest general alternative."`,
        `CRITICAL REJECTION RULE: If the user message asks for general-purpose AI tasks completely unrelated to pets, animals, or UK business directory services (e.g., writing software code, translation, mathematical puzzles, general essays, or creative writing prompts), you must immediately reject it. Respond ONLY with this exact sentence: 'I am your PawFinder assistant and can only help with pet care queries and local UK business matching. How can I help you find a pet service today?' Do not process or generate any additional content.`,
        `When recommending a business, format its name as [Business Name](provider:UUID_HERE) so the frontend can render it as an interactive element. You MAY wrap that linked business name in bold for emphasis, but the link itself is the critical requirement. Replace UUID_HERE with the exact Provider ID from the PawFinder business list.`,
        'Recommended response shape: one short opening line, then --- on its own line, then up to 3 bullet points.',
        'Preferred response style: - **[Business Name](provider:UUID_HERE)** | **4.8 stars** | **1.2 miles away** | 12 High Street, Sheffield | One short highlight sentence.',
        'If that exact single-line layout feels unnatural, keep the same facts but use 2 short lines per recommendation rather than refusing or degrading into generic fallback text.',
        'Use only the businesses and facts provided by PawFinder.',
        'Do not invent breed feedback, review summaries, facilities, or specialties.',
        'If a provider has review_summary or breed_tags, use them as your strongest proof of fit.',
        'When you use the cold-start transparency line, replace the placeholder rating and review count with the actual values from the business data.',
        'Keep the answer practical and direct. Recommend up to 3 businesses in rank order with clear reasons.',
      ].join('\n')
    : [
        ...sharedFormattingRules,
        `Instruction: "If the incoming payload has no postcode or mapped location data, acknowledge what the user wants in 1 short line and ask them to share their postcode or city so PawFinder can pull nearby matches."`,
        `Interpretation Rule: "Short category requests like 'groomers near me', 'dog walkers', 'boarders', or 'vets' are valid pet-care intents on PawFinder. Ask for location only because location is missing, not because the request is off-topic."`,
        `CRITICAL REJECTION RULE: If the user message asks for general-purpose AI tasks completely unrelated to pets, animals, or UK business directory services (e.g., writing software code, translation, mathematical puzzles, general essays, or creative writing prompts), you must immediately reject it. Respond ONLY with this exact sentence: 'I am your PawFinder assistant and can only help with pet care queries and local UK business matching. How can I help you find a pet service today?' Do not process or generate any additional content.`,
        'Do not recommend specific businesses yet.',
        'Use 2 to 4 short lines max, with bullets if helpful.',
        'Explain briefly what signals you would use once location is available, such as breed fit, review summaries, ratings, and distance.',
        'Keep the answer warm, direct, and concise.',
      ].join('\n')
  const contextMessage = hasLocationContext
    ? `Search context:\nPostcode: ${locationContext.postcode || 'None'}\nLocation: ${
        locationContext.location || 'None'
      }\nNearby businesses:\n${buildProviderContext(providers)}`
    : 'Search context: none provided yet. Ask for the user postcode or city before trying to compare nearby businesses.'

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
          content: contextMessage,
        },
        ...messages,
      ],
    }),
  })

  const rawBody = await response.text()

  if (!response.ok) {
    console.error('[assistant-chat] DeepSeek request failed')
    throw new Error('DeepSeek request failed')
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
    let body: unknown

    try {
      body = await request.json()
    } catch {
      console.error('[assistant-chat] Invalid JSON body')
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const parsedBody = (body || {}) as {
      messages?: unknown
      postcode?: unknown
      location?: unknown
      lat?: unknown
      lng?: unknown
    }

    const messages = normalizeMessages(parsedBody.messages)
    validateIncomingMessages(messages)
    const postcode =
      typeof parsedBody.postcode === 'string' && parsedBody.postcode.trim().length > 0
        ? normalizePostcode(parsedBody.postcode)
        : null
    const location =
      typeof parsedBody.location === 'string' && parsedBody.location.trim().length > 0
        ? parsedBody.location.trim()
        : null
    const lat =
      typeof parsedBody.lat === 'number' && Number.isFinite(parsedBody.lat) ? parsedBody.lat : null
    const lng =
      typeof parsedBody.lng === 'number' && Number.isFinite(parsedBody.lng) ? parsedBody.lng : null

    if (messages.length === 0) {
      return NextResponse.json({ error: 'At least one user message is required' }, { status: 400 })
    }

    if (postcode && !isValidPostcode(postcode)) {
      return NextResponse.json(
        { error: 'Please enter a full, valid UK postcode (e.g. S10 1BD)' },
        { status: 400 }
      )
    }

    if ((lat === null) !== (lng === null)) {
      return NextResponse.json({ error: 'Both lat and lng are required together' }, { status: 400 })
    }

    const locationContext = {
      postcode,
      location,
      lat,
      lng,
    } satisfies AssistantLocationContext

    const hasSearchContext = Boolean(postcode || (location && lat !== null && lng !== null))

    if (!hasSearchContext) {
      const reply = await getAssistantReply(messages, locationContext, [])

      return NextResponse.json({
        reply,
        providers: [],
        needs_location: true,
      })
    }

    const nearbyProviders = postcode
      ? await fetchNearbyProviders(request, postcode)
      : await fetchNearbyProvidersByLocation(request, location!, lat!, lng!)

    if (nearbyProviders.length === 0) {
      return NextResponse.json({
        reply:
          `I couldn't find any nearby PawFinder providers to compare in ${
            postcode || location
          } yet. Try a nearby postcode or broaden the type of care you're looking for.`,
        providers: [],
        needs_location: false,
      })
    }

    const providers = await enrichProvidersIfNeeded(request, nearbyProviders)
    const reply = await getAssistantReply(messages, locationContext, providers)

    return NextResponse.json({
      reply,
      providers,
      needs_location: false,
    })
  } catch (error) {
    if (error instanceof AssistantRouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('[assistant-chat] Unhandled assistant error')
    return NextResponse.json({ error: SAFE_ASSISTANT_ERROR }, { status: 500 })
  }
}
