const SAFE_PUBLIC_PROTOCOLS = new Set(['http:', 'https:'])
const SAFE_PUBLIC_PORTS = new Set(['', '80', '443'])
const STRIPE_CHECKOUT_HOSTS = new Set([
  'checkout.stripe.com',
  'billing.stripe.com',
])

function isPrivateIpv4Host(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false

  const octets = hostname.split('.').map((part) => Number(part))
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return true

  const [a, b] = octets

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIpv6Host(hostname: string) {
  const normalized = hostname.trim().toLowerCase()

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  )
}

function isBlockedPublicHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()

  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'host.docker.internal' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === 'metadata' ||
    normalized === 'metadata.google.internal' ||
    normalized === '169.254.169.254' ||
    isPrivateIpv4Host(normalized) ||
    isPrivateIpv6Host(normalized)
  )
}

function parseSafePublicUrl(value: string | null | undefined) {
  if (!value) return null
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  try {
    const url = new URL(/^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`)

    if (!SAFE_PUBLIC_PROTOCOLS.has(url.protocol)) return null
    if (url.username || url.password) return null
    if (!SAFE_PUBLIC_PORTS.has(url.port)) return null
    if (isBlockedPublicHostname(url.hostname)) return null

    return url
  } catch {
    return null
  }
}

export function getSafePublicExternalUrl(value: string | null | undefined) {
  return parseSafePublicUrl(value)?.toString() || null
}

export function isAllowedStripeCheckoutUrl(value: string | null | undefined) {
  const url = parseSafePublicUrl(value)
  if (!url) return false

  return STRIPE_CHECKOUT_HOSTS.has(url.hostname.toLowerCase())
}
