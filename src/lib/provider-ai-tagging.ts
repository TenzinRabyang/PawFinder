import {
  BREED_VALUES_BY_ANIMAL,
  normalizeBreedValues,
  normalizeGeneralAnimalCoverage,
} from '@/lib/breed-taxonomy'

export type AiTags = {
  animals_served: string[]
  services: string[]
  breeds_specialised: string[]
  breeds_general_inferred: string[]
  has_online_booking: boolean
}

export type TagProviderWebsiteResult = {
  normalizedWebsite: string
  pagesAnalysed: number
  pagesAttempted: number
  pagesFetched: number
  aiTags: AiTags
  originalCharCount: number
  truncatedCharCount: number
  skippedLowContent: boolean
  bookingAnalysis: {
    hasOnlineBooking: boolean
    bookingUrl: string | null
    detectionSource: 'link' | 'ai' | 'none'
  }
}

export class WebsiteFetchError extends Error {
  status?: number
  reason: 'fetch_blocked' | 'fetch_failed'
  url: string

  constructor(message: string, options: { url: string; status?: number; reason: 'fetch_blocked' | 'fetch_failed' }) {
    super(message)
    this.name = 'WebsiteFetchError'
    this.url = options.url
    this.status = options.status
    this.reason = options.reason
  }
}

const SUPPORTED_ANIMALS = new Set(['dog', 'cat', 'rabbit'])
const MAX_SOURCE_PAGES = 3
const MAX_CONTEXT_CHARS = 5000
const MIN_CONTENT_CHARS = 200
const PAGE_FETCH_TIMEOUT_MS = 5000
const TOTAL_FETCH_BUDGET_MS = 12000
const BOOKING_KEYWORD_REGEX =
  /\b(book|booking|bookings|appointment|appointments|schedule|reserve|reservation|consultation)\b/i
const BOOKING_VENDOR_REGEX =
  /(calendly|acuityscheduling|squareup|booksy|setmore|fresha|phorest|simplybook|cliniko|vagaro|timify|10to8|appointlet)/i
const RELEVANT_SUBPAGE_REGEX =
  /(service|services|about|faq|care|treatment|treatments|breed|dog|cat|rabbit|groom|boarding|walker|walking|trainer|training|mobile)/i

type WebsitePage = {
  url: string
  html: string
  text: string
}

function normalizeWebsiteUrl(url: string) {
  const trimmedUrl = url.trim()
  if (!trimmedUrl) return null

  try {
    return new URL(/^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`)
  } catch {
    return null
  }
}

function stripHtmlToText(html: string) {
  const metaContent = Array.from(html.matchAll(/<meta\b[^>]*content=["']([^"']+)["'][^>]*>/gi))
    .map((match) => match[1]?.trim() || '')
    .filter(Boolean)
    .join(' ')
  const titleContent = Array.from(html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi))
    .map((match) => match[1]?.trim() || '')
    .filter(Boolean)
    .join(' ')

  return `${titleContent} ${metaContent} ${html}`
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreBookingCandidate(url: URL, anchorText: string) {
  const urlText = `${url.hostname}${url.pathname}${url.search}`
  let score = 0

  if (BOOKING_VENDOR_REGEX.test(url.hostname)) score += 4
  if (BOOKING_KEYWORD_REGEX.test(urlText)) score += 3
  if (BOOKING_KEYWORD_REGEX.test(anchorText)) score += 2

  return score
}

function extractBookingLink(html: string, baseUrl: URL) {
  const matches = html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)
  let bestCandidate: { url: string; score: number } | null = null

  for (const match of matches) {
    const href = match[1]

    try {
      const url = new URL(href, baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) continue

      const anchorText = stripHtmlToText(match[2] || '')
      const score = scoreBookingCandidate(url, anchorText)
      if (score <= 0) continue

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { url: url.toString(), score }
      }
    } catch {
      continue
    }
  }

  return bestCandidate?.url || null
}

function scoreRelevantLink(url: URL) {
  const path = `${url.pathname}${url.search}`
  let score = 0

  if (/(breed|breeds)/i.test(path)) score += 5
  if (/(service|services)/i.test(path)) score += 4
  if (/(care|treatment|treatments|clinical)/i.test(path)) score += 3
  if (/(faq|about)/i.test(path)) score += 2
  if (/(dog|cat|rabbit|groom|boarding|walker|walking|trainer|training|mobile)/i.test(path)) score += 1

  return score
}

function normalizeServiceValues(values: unknown) {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '_') : ''))
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set(normalized))
}

function normalizeAnimalValues(values: unknown) {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value): value is string => SUPPORTED_ANIMALS.has(value))

  return Array.from(new Set(normalized))
}

function inferServicesFromContext(existingServices: string[], websiteContext: string) {
  const inferredServices = new Set(existingServices)
  const context = websiteContext.toLowerCase()

  if (/groom|grooming|groomer/.test(context)) inferredServices.add('grooming')
  if (/boarding|boarder|kennel|day care|daycare/.test(context)) inferredServices.add('boarding')
  if (/dog walk|dog walking|walker|walking|walkies/.test(context)) inferredServices.add('dog_walking')
  if (/pet sitting|pet sitter|overnight sitting|drop-in|drop in/.test(context)) inferredServices.add('pet_sitting')
  if (/pet taxi|transport/.test(context)) inferredServices.add('pet_taxi')

  return Array.from(inferredServices)
}

function inferGeneralCoverageFromServiceContext(services: string[], websiteContext: string, existingCoverage: string[]) {
  const inferredCoverage = new Set(existingCoverage)
  const context = websiteContext.toLowerCase()
  const hasPetContext = /\bpet\b|\bpets\b/.test(context)
  const hasDogContext = /\bdog\b|\bdogs\b|\bpuppy\b|\bpuppies\b|\bcanine\b/.test(context)
  const hasCatContext = /\bcat\b|\bcats\b|\bkitten\b|\bkittens\b|\bfeline\b/.test(context)
  const hasRabbitContext = /\brabbit\b|\brabbits\b|\bbunny\b|\bbunnies\b/.test(context)

  const addCoverage = (animal: 'dog' | 'cat' | 'rabbit') => {
    inferredCoverage.add(animal)
  }

  for (const service of services) {
    if (!service) continue

    if (/dog|walking|walkies|dog_walking/.test(service)) {
      addCoverage('dog')
    }

    if (/cat/.test(service)) {
      addCoverage('cat')
    }

    if (/rabbit|bunny/.test(service)) {
      addCoverage('rabbit')
    }

    if (/groom/.test(service)) {
      if (hasDogContext) addCoverage('dog')
      if (hasCatContext) addCoverage('cat')
      if (hasRabbitContext) addCoverage('rabbit')

      // "Pet grooming" on a companion-pet site is a strong broad signal for dogs/cats,
      // but bare "grooming" with no surrounding pet context should not trigger a guess.
      if (!hasDogContext && !hasCatContext && !hasRabbitContext && hasPetContext) {
        addCoverage('dog')
        addCoverage('cat')
      }
    }

    if (/pet_sitting|drop_in|overnight|pet_taxi|home_visit|feeding|playtime|boarding|daycare|day_care/.test(service)) {
      if (hasDogContext) addCoverage('dog')
      if (hasCatContext) addCoverage('cat')
      if (hasRabbitContext) addCoverage('rabbit')

      if (!hasDogContext && !hasCatContext && !hasRabbitContext && hasPetContext) {
        addCoverage('dog')
        addCoverage('cat')
      }
    }
  }

  return Array.from(inferredCoverage)
}

function extractRelevantLinks(html: string, baseUrl: URL) {
  const matches = html.matchAll(/href=["']([^"'#]+)["']/gi)
  const candidates = new Map<string, number>()

  for (const match of matches) {
    const href = match[1]

    try {
      const url = new URL(href, baseUrl)
      const sameOrigin = url.origin === baseUrl.origin
      const relevantPath = RELEVANT_SUBPAGE_REGEX.test(url.pathname)

      if (sameOrigin && relevantPath) {
        candidates.set(url.toString(), scoreRelevantLink(url))
      }
    } catch {
      continue
    }
  }

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, MAX_SOURCE_PAGES - 1)
}

async function fetchPageText(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new WebsiteFetchError(`Failed to fetch ${url}: ${response.status}`, {
      url,
      status: response.status,
      reason: response.status >= 400 && response.status < 500 ? 'fetch_blocked' : 'fetch_failed',
    })
  }

  const html = await response.text()

  return {
    html,
    text: stripHtmlToText(html),
  }
}

async function collectWebsiteContext(website: string) {
  const normalizedUrl = normalizeWebsiteUrl(website)
  if (!normalizedUrl) {
    throw new Error('Invalid website URL')
  }

  const startedAt = Date.now()
  let homePage: Awaited<ReturnType<typeof fetchPageText>>

  try {
    homePage = await fetchPageText(normalizedUrl.toString(), PAGE_FETCH_TIMEOUT_MS)
  } catch (error) {
    if (error instanceof WebsiteFetchError) {
      throw error
    }

    throw new WebsiteFetchError(`Failed to fetch ${normalizedUrl.toString()}`, {
      url: normalizedUrl.toString(),
      reason: 'fetch_failed',
    })
  }

  const extraLinks = extractRelevantLinks(homePage.html, normalizedUrl)
  const pages: WebsitePage[] = [{ url: normalizedUrl.toString(), html: homePage.html, text: homePage.text }]
  let pagesAttempted = 1

  for (const link of extraLinks) {
    const elapsedMs = Date.now() - startedAt
    const remainingMs = TOTAL_FETCH_BUDGET_MS - elapsedMs

    if (remainingMs <= 0) {
      console.warn('[provider-ai-tagging] total fetch budget exceeded before extra page fetch')
      break
    }

    pagesAttempted += 1

    try {
      const page = await fetchPageText(link, Math.min(PAGE_FETCH_TIMEOUT_MS, remainingMs))
      if (page.text) {
        pages.push({ url: link, html: page.html, text: page.text })
      }
    } catch {
      console.error('[provider-ai-tagging] failed to fetch extra page')
    }
  }

  const combinedContext = pages
    .map((page, index) => `Page ${index + 1}: ${page.url}\n${page.text}`)
    .join('\n\n')

  return {
    normalizedWebsite: normalizedUrl.toString(),
    combinedContext,
    pagesAnalysed: pages.length,
    pagesAttempted,
    pagesFetched: pages.length,
    pages,
  }
}

async function analyzeWithDeepSeek(websiteContext: string): Promise<AiTags> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key || !websiteContext) {
    return {
      animals_served: [],
      services: [],
      breeds_specialised: [],
      breeds_general_inferred: [],
      has_online_booking: false,
    }
  }

  const supportedDogBreeds = BREED_VALUES_BY_ANIMAL.dog.join(', ')
  const supportedCatBreeds = BREED_VALUES_BY_ANIMAL.cat.join(', ')
  const supportedRabbitBreeds = BREED_VALUES_BY_ANIMAL.rabbit.join(', ')

  const prompt = `
Analyze the following business website excerpts and return JSON only:
{
  "animals_served": ["dog", "cat", "rabbit"],
  "services": ["grooming", "boarding"],
  "breeds_specialised": ["poodle", "greyhound"],
  "breeds_general_inferred": ["dog", "cat"],
  "has_online_booking": true
}

Rules:
- Only use supported animals from: dog, cat, rabbit.
- Only include services clearly offered by the business.
- For "animals_served", use animal types explicitly named on the site, plus animal types that are clearly and unambiguously implied by a specific service name or nearby context.
- For "breeds_specialised", only use breed values from this taxonomy.
- For "breeds_general_inferred", only use animal types from: dog, cat, rabbit.
- Use "breeds_specialised" only for breeds explicitly named or strongly implied as a specific specialism.
- Use "breeds_general_inferred" when the site clearly states or strongly implies broad all-breed coverage for an animal type without naming specific breeds.
- Do not add an animal type to "breeds_general_inferred" if the text is vague or unclear.
- Infer broad animal coverage from service context only when the implication is strong. Examples: "dog walking" => dog, "cat boarding" => cat, "rabbit grooming" => rabbit.
- A generic service like "grooming" alone is not enough to infer an animal. Only use it when nearby context clearly points to companion pets, such as repeated "pet/pets" wording or business/site copy that strongly indicates dog/cat services.
- If the business name or surrounding copy indicates a companion-pet service and the offered services are things like grooming, pet sitting, drop-in visits, boarding, or pet taxi, it is acceptable to infer broad dog/cat coverage in "breeds_general_inferred".
- Only set "has_online_booking" to true when the website clearly offers online booking, appointment scheduling, or a direct booking portal.
- Do not treat a plain contact form, phone number, or email address as online booking.
- Dog breeds: ${supportedDogBreeds}
- Cat breeds: ${supportedCatBreeds}
- Rabbit breeds: ${supportedRabbitBreeds}
- If the site clearly says it supports all dogs or dogs in general with no breed restriction, put "dog" in "breeds_general_inferred" unless specific dog breeds are clearly highlighted as specialisms.
- If the site clearly says it supports all cats or cats in general with no breed restriction, put "cat" in "breeds_general_inferred" unless specific cat breeds are clearly highlighted as specialisms.
- If the site clearly says it supports all rabbits or rabbits in general with no breed restriction, put "rabbit" in "breeds_general_inferred" unless specific rabbit breeds are clearly highlighted as specialisms.
- Do not invent breeds outside the taxonomy.
- If information is missing, return an empty array for that field.

Website excerpts:
${websiteContext}
`

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(4500),
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    })

    const rawBody = await response.text()
    const data = JSON.parse(rawBody)
    const parsedContent = data?.choices?.[0]?.message?.content
    const parsed = JSON.parse(parsedContent)

    const normalizedServices = inferServicesFromContext(normalizeServiceValues(parsed.services), websiteContext)
    const normalizedGeneralCoverage = normalizeGeneralAnimalCoverage(parsed.breeds_general_inferred)

    return {
      animals_served: normalizeAnimalValues(parsed.animals_served),
      services: normalizedServices,
      breeds_specialised: normalizeBreedValues(parsed.breeds_specialised),
      breeds_general_inferred: inferGeneralCoverageFromServiceContext(
        normalizedServices,
        websiteContext,
        normalizedGeneralCoverage
      ),
      has_online_booking: typeof parsed.has_online_booking === 'boolean' ? parsed.has_online_booking : false,
    }
  } catch {
    console.error('[provider-ai-tagging] DeepSeek analysis failed')
    return {
      animals_served: [],
      services: [],
      breeds_specialised: [],
      breeds_general_inferred: [],
      has_online_booking: false,
    }
  }
}

export async function tagProviderWebsite(website: string): Promise<TagProviderWebsiteResult> {
  const { normalizedWebsite, combinedContext, pagesAnalysed, pagesAttempted, pagesFetched, pages } =
    await collectWebsiteContext(website)
  const originalCharCount = combinedContext.length
  const truncatedContext = combinedContext.slice(0, MAX_CONTEXT_CHARS)
  const truncatedCharCount = truncatedContext.length
  const skippedLowContent = truncatedCharCount < MIN_CONTENT_CHARS
  const bookingUrl =
    pages
      .map((page) => {
        try {
          return extractBookingLink(page.html, new URL(page.url))
        } catch {
          return null
        }
      })
      .find((value): value is string => Boolean(value)) || null

  if (skippedLowContent) {
    return {
      normalizedWebsite,
      pagesAnalysed,
      pagesAttempted,
      pagesFetched,
      aiTags: {
        animals_served: [],
        services: [],
        breeds_specialised: [],
        breeds_general_inferred: [],
        has_online_booking: false,
      },
      originalCharCount,
      truncatedCharCount,
      skippedLowContent,
      bookingAnalysis: {
        hasOnlineBooking: Boolean(bookingUrl),
        bookingUrl,
        detectionSource: bookingUrl ? 'link' : 'none',
      },
    }
  }

  const aiTags = await analyzeWithDeepSeek(truncatedContext)
  const hasOnlineBooking = Boolean(bookingUrl) || aiTags.has_online_booking

  return {
    normalizedWebsite,
    pagesAnalysed,
    pagesAttempted,
    pagesFetched,
    aiTags,
    originalCharCount,
    truncatedCharCount,
    skippedLowContent,
    bookingAnalysis: {
      hasOnlineBooking,
      bookingUrl,
      detectionSource: bookingUrl ? 'link' : aiTags.has_online_booking ? 'ai' : 'none',
    },
  }
}
