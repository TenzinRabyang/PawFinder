export function validateSameOriginRequest(request: Request) {
  const requestUrl = new URL(request.url)
  const expectedOrigins = new Set([requestUrl.origin])
  const forwardedProtocol = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host')

  if (forwardedHost) {
    const protocol = forwardedProtocol || requestUrl.protocol.replace(/:$/, '')
    expectedOrigins.add(`${protocol}://${forwardedHost}`)
  }

  const originHeader = request.headers.get('origin')
  const refererHeader = request.headers.get('referer')

  if (originHeader) {
    try {
      if (expectedOrigins.has(new URL(originHeader).origin)) {
        return null
      }
    } catch {
      return 'Invalid request origin'
    }

    return 'Cross-site request blocked'
  }

  if (refererHeader) {
    try {
      if (expectedOrigins.has(new URL(refererHeader).origin)) {
        return null
      }
    } catch {
      return 'Invalid request referer'
    }

    return 'Cross-site request blocked'
  }

  return 'Missing origin headers'
}
