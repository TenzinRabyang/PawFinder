import { NextResponse } from 'next/server'

type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitConfig = {
  key: string
  limit: number
  windowMs: number
  message: string
}

const MAX_TRACKED_KEYS = 5000
const rateLimitStore = new Map<string, RateLimitEntry>()

function pruneExpiredEntries(now: number) {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key)
    }
  }

  if (rateLimitStore.size <= MAX_TRACKED_KEYS) {
    return
  }

  const oldestEntries = [...rateLimitStore.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, rateLimitStore.size - MAX_TRACKED_KEYS)

  for (const [key] of oldestEntries) {
    rateLimitStore.delete(key)
  }
}

function getFirstForwardedAddress(value: string | null) {
  if (!value) return null

  const firstAddress = value
    .split(',')
    .map((part) => part.trim())
    .find(Boolean)

  return firstAddress || null
}

function getClientIdentifier(request: Request) {
  const forwardedAddress = getFirstForwardedAddress(request.headers.get('x-forwarded-for'))
  const clientIp =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-vercel-forwarded-for') ||
    forwardedAddress

  if (clientIp) {
    return clientIp
  }

  const userAgent = request.headers.get('user-agent')?.trim()
  if (userAgent) {
    return `ua:${userAgent.slice(0, 160)}`
  }

  return 'anonymous'
}

function buildRateLimitHeaders(config: RateLimitConfig, entry: RateLimitEntry, now: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  const remaining = Math.max(0, config.limit - entry.count)

  return {
    'Retry-After': String(retryAfterSeconds),
    'X-RateLimit-Limit': String(config.limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': new Date(entry.resetAt).toISOString(),
  }
}

export function enforceRouteRateLimit(request: Request, config: RateLimitConfig) {
  const now = Date.now()
  pruneExpiredEntries(now)

  const clientIdentifier = getClientIdentifier(request)
  const storageKey = `${config.key}:${clientIdentifier}`
  const existingEntry = rateLimitStore.get(storageKey)

  if (!existingEntry || existingEntry.resetAt <= now) {
    const nextEntry = {
      count: 1,
      resetAt: now + config.windowMs,
    }

    rateLimitStore.set(storageKey, nextEntry)
    return null
  }

  const nextEntry = {
    ...existingEntry,
    count: existingEntry.count + 1,
  }

  rateLimitStore.set(storageKey, nextEntry)

  if (nextEntry.count <= config.limit) {
    return null
  }

  return NextResponse.json(
    {
      error: config.message,
    },
    {
      status: 429,
      headers: buildRateLimitHeaders(config, nextEntry, now),
    }
  )
}

export function buildForwardedClientHeaders(request: Request) {
  const headers: Record<string, string> = {}
  const headerNames = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'x-vercel-forwarded-for']

  for (const headerName of headerNames) {
    const headerValue = request.headers.get(headerName)
    if (headerValue) {
      headers[headerName] = headerValue
    }
  }

  return headers
}
