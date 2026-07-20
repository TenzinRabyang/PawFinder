# Security Review Report

## Executive Summary

PawFinder builds and serves successfully, but the audit found multiple high-risk backend issues that should be prioritized before broader launch hardening. The most serious problems are unauthenticated service-role routes that can mutate provider data and trigger server-side fetches to arbitrary websites, plus a logged-in route that lets any authenticated user overwrite AI review summaries for any provider.

The frontend is in better shape from an XSS perspective, but the app currently lacks visible CSP and baseline security headers in app code/runtime responses, and some cookie-authenticated POST flows have no explicit CSRF defenses. Public route smoke tests returned `200`, `next build` passed, and `npm audit` reported moderate dependency advisories, but this does not offset the server-side authorization issues below.

## Critical Findings

### 1. Unauthenticated service-role mutation and SSRF in `ensure-tags`

- **Rule IDs:** `NEXT-AUTH-001`, `NEXT-SSRF-001`
- **Severity:** Critical
- **Location:** [route.ts:L157-L176](file:///workspace/src/app/api/providers/[id]/ensure-tags/route.ts#L157-L176), [route.ts:L665-L699](file:///workspace/src/app/api/providers/[id]/ensure-tags/route.ts#L665-L699), [provider-ai-tagging.ts:L64-L73](file:///workspace/src/lib/provider-ai-tagging.ts#L64-L73), [provider-ai-tagging.ts:L263-L273](file:///workspace/src/lib/provider-ai-tagging.ts#L263-L273), [provider-ai-tagging.ts:L291-L301](file:///workspace/src/lib/provider-ai-tagging.ts#L291-L301)
- **Evidence:** The route creates an admin client immediately and accepts JSON input without any user check:

```ts
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabaseAdmin = createAdminClient()
  const body = (await request.json().catch(() => ({}))) as EnsureTagsBody
```

```ts
const { normalizedWebsite, ... } = await tagProviderWebsite(websiteToAnalyze)
```

```ts
async function fetchPageText(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
}
```

- **Impact:** Anyone who can reach this endpoint can force server-side website fetches and update provider records using service-role privileges.
- **Fix:** Require authenticated ownership/admin authorization before any read or write, and restrict website fetching to a strict allowlist or SSRF-safe validator that blocks localhost, private IPs, metadata endpoints, and unsafe redirects.
- **Mitigation:** Disable this route outside trusted admin contexts until it is protected.
- **False positive notes:** None; the route currently lacks any visible auth/authz gate.

### 2. Unauthenticated admin seeding endpoint writes directly to production tables

- **Rule IDs:** `NEXT-AUTH-001`, `NEXT-INPUT-001`
- **Severity:** Critical
- **Location:** [route.ts:L30-L47](file:///workspace/src/app/api/seed/postcode/route.ts#L30-L47), [route.ts:L100-L135](file:///workspace/src/app/api/seed/postcode/route.ts#L100-L135)
- **Evidence:** The route builds a service-role client and accepts arbitrary POST input with no auth:

```ts
export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    supabaseUrl,
    serviceRoleKey
  )
  const { postcode } = await request.json()
```

```ts
const { data: provider, error: providerError } = await supabaseAdmin
  .from('pf_providers')
  .insert({
    name: place.name,
    category: cat.key,
    ...
  })
```

- **Impact:** An attacker can seed/spam provider data, trigger third-party API usage, and consume AI tagging resources without authentication.
- **Fix:** Require admin-only authorization, or remove/disable the route from deployed environments.
- **Mitigation:** Gate it behind environment checks plus server-side admin verification.
- **False positive notes:** None; no auth boundary is visible in the route.

## High Findings

### 3. Any authenticated user can overwrite any provider review summary

- **Rule IDs:** `NEXT-AUTH-001`
- **Severity:** High
- **Location:** [route.ts:L5-L15](file:///workspace/src/app/api/reviews/[providerId]/ai-summary/route.ts#L5-L15), [route.ts:L19-L25](file:///workspace/src/app/api/reviews/[providerId]/ai-summary/route.ts#L19-L25), [route.ts:L58-L65](file:///workspace/src/app/api/reviews/[providerId]/ai-summary/route.ts#L58-L65)
- **Evidence:** The route checks only that a user is logged in, then reads and updates data for whatever `providerId` is in the URL:

```ts
if (authError || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

```ts
const { data: pf_reviews } = await supabaseAdmin
  .from('pf_reviews')
  .select(...)
  .eq('provider_id', providerId)
```

```ts
await supabaseAdmin
  .from('pf_providers')
  .update({
    review_summary: summary,
    review_summary_updated_at: new Date().toISOString()
  })
  .eq('id', providerId)
```

- **Impact:** Any logged-in user can regenerate and overwrite summaries for arbitrary providers.
- **Fix:** Require ownership, admin role, or a trusted internal-only caller before updating `pf_providers`.
- **Mitigation:** Restrict this route to server-internal use only until authz is added.
- **False positive notes:** None; no provider ownership check exists.

### 4. Cookie-authenticated POST routes lack explicit CSRF protection

- **Rule IDs:** `NEXT-CSRF-001`
- **Severity:** High
- **Location:** [Navbar.tsx:L18-L30](file:///workspace/src/components/Navbar.tsx#L18-L30), [route.ts:L4-L10](file:///workspace/src/app/auth/signout/route.ts#L4-L10), [reanalyze-button.tsx:L17-L20](file:///workspace/src/app/business/dashboard/reanalyze-button.tsx#L17-L20), [route.ts:L20-L29](file:///workspace/src/app/api/business/reanalyze/route.ts#L20-L29), [route.ts:L4-L17](file:///workspace/src/app/api/reviews/route.ts#L4-L17), [route.ts:L17-L26](file:///workspace/src/app/api/stripe/checkout/route.ts#L17-L26)
- **Evidence:** State-changing POST handlers authorize via `supabase.auth.getUser()` but do not perform CSRF token or Origin/Referer validation. Signout is especially easy to trigger cross-site because it is a plain form POST:

```tsx
<form action="/auth/signout" method="post">
  <button>Sign out</button>
</form>
```

```ts
export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return Response.redirect(origin)
}
```

- **Impact:** If auth cookies are sent in cross-site contexts, attackers may be able to trigger unwanted account actions such as signout or backend analysis jobs.
- **Fix:** Add CSRF protection for cookie-authenticated POST/PUT/PATCH/DELETE routes using strict Origin checks and/or CSRF tokens.
- **Mitigation:** Keep SameSite protections strict and reduce exposed state-changing POST routes.
- **False positive notes:** Real-world exploitability depends on Supabase cookie behavior and browser cookie settings, but the app code has no explicit CSRF backstop.

### 5. Authenticated SSRF path in business claim

- **Rule IDs:** `NEXT-SSRF-001`
- **Severity:** High
- **Location:** [route.ts:L50-L55](file:///workspace/src/app/api/business/claim/route.ts#L50-L55), [route.ts:L201-L206](file:///workspace/src/app/api/business/claim/route.ts#L201-L206), [provider-ai-tagging.ts:L64-L73](file:///workspace/src/lib/provider-ai-tagging.ts#L64-L73), [provider-ai-tagging.ts:L263-L273](file:///workspace/src/lib/provider-ai-tagging.ts#L263-L273)
- **Evidence:** User-supplied `website` is accepted from the request body and passed into server-side website fetching:

```ts
const { google_place_id, name, address, category, googleTypes, website, phone } = body
```

```ts
const { normalizedWebsite, ... } = await tagProviderWebsite(website)
```

- **Impact:** Any authenticated user can induce server-side outbound requests to arbitrary domains during business claiming.
- **Fix:** Validate destinations strictly before fetching and block private/internal targets.
- **Mitigation:** Restrict website analysis to trusted/verified domains or defer fetches to a hardened worker.
- **False positive notes:** Lower impact than `ensure-tags` because this route requires login, but the SSRF primitive is still present.

## Medium Findings

### 6. Missing visible CSP and baseline security headers

- **Rule IDs:** `NEXT-HEADERS-001`, `NEXT-CSP-001`, `REACT-CSP-001`
- **Severity:** Medium
- **Location:** [next.config.ts:L3-L19](file:///workspace/next.config.ts#L3-L19), [layout.tsx:L40-L45](file:///workspace/src/app/layout.tsx#L40-L45)
- **Evidence:** App config defines image/dev origin settings only and loads third-party analytics, but no app-level header configuration is visible:

```ts
const nextConfig: NextConfig = {
  images: { ... },
  allowedDevOrigins: [ ... ],
};
```

```tsx
<body ...>
  <main className="flex-1">{children}</main>
  <Analytics />
```

- **Runtime validation:** Local production smoke checks on `/`, `/login`, and `/privacy` returned `200` but did not include `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, or `X-Content-Type-Options`.
- **Impact:** If any injection bug appears later, there is less browser-enforced defense-in-depth. The app also has weaker protection against clickjacking and content sniffing.
- **Fix:** Add a header policy in app or edge config with at least CSP, `nosniff`, clickjacking defense, `Referrer-Policy`, and `Permissions-Policy`.
- **Mitigation:** Verify whether Vercel or another edge layer already sets these in production; if not, add them centrally.
- **False positive notes:** This may already be handled outside the repo, but it is not visible in app code or local runtime headers.

### 7. Browser auth client persists session in local storage by default

- **Rule IDs:** `REACT-AUTH-001`
- **Severity:** Medium
- **Location:** [client.ts:L4-L10](file:///workspace/src/utils/supabase/client.ts#L4-L10), [createBrowserClient.ts:L128-L143](file:///workspace/node_modules/@supabase/ssr/src/createBrowserClient.ts#L128-L143), [SupabaseClient.ts:L106-L108](file:///workspace/node_modules/@supabase/supabase-js/src/SupabaseClient.ts#L106-L108)
- **Evidence:** App code creates the browser client without overriding auth persistence:

```ts
export function createClient() {
  return createBrowserClient(
    url,
    anonKey
  )
}
```

The library default is:

```ts
persistSession: options?.auth?.persistSession ?? true,
userStorage: options?.auth?.userStorage ?? window.localStorage,
```

- **Impact:** If a browser-side XSS bug lands later, persisted auth/session material is easier to steal.
- **Fix:** Prefer cookie-based session handling or explicitly review and minimize browser-side persisted auth data.
- **Mitigation:** Harden CSP and DOM/XSS posture to reduce token theft risk.
- **False positive notes:** This is a framework-default exposure pattern rather than proof of an active compromise.

### 8. Provider and booking links trust database URL content too broadly

- **Rule IDs:** `REACT-URL-001`
- **Severity:** Medium
- **Location:** [ProviderProfileClient.tsx:L203-L208](file:///workspace/src/app/provider/[id]/ProviderProfileClient.tsx#L203-L208), [ProviderProfileClient.tsx:L891-L894](file:///workspace/src/app/provider/[id]/ProviderProfileClient.tsx#L891-L894), [ProviderProfileClient.tsx:L1154-L1168](file:///workspace/src/app/provider/[id]/ProviderProfileClient.tsx#L1154-L1168)
- **Evidence:** The app only normalizes scheme presence before rendering outbound links:

```ts
const normalizeExternalUrl = (url: string | null | undefined) => {
  if (!url) return null
  const trimmedUrl = url.trim()
  if (!trimmedUrl) return null
  return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
}
```

- **Impact:** If provider website or booking URL data is poisoned in the database, users can be sent directly to phishing or malware sites from trusted business pages.
- **Fix:** Validate link destinations more strictly, or send outbound business URLs through a warning/interstitial flow.
- **Mitigation:** At minimum, allow only `http:`/`https:` and consider adding visible external-link warnings.
- **False positive notes:** This is not direct XSS, but it is a user-safety and phishing risk.

## Validation Results

- **Build:** `npm run build` passed.
- **Runtime smoke:** local production server started successfully and returned:
  - `/` -> `200`
  - `/login` -> `200`
  - `/privacy` -> `200`
  - `/business/subscribe` -> `200`
- **Runtime header observation:** those responses did not include visible CSP or other common security headers in local runtime output.
- **Dependency scan:** `npm audit --omit=dev --json` reported 3 moderate advisories, centered on `next` / bundled `postcss` and propagated into `@vercel/analytics`.
- **Lint/static hygiene:** `npm run lint` failed with many pre-existing issues, including route typing problems and React lint violations. These are not all security bugs, but they reduce confidence and should be cleaned up.

## Priority Remediation Order

1. Lock down or disable `src/app/api/providers/[id]/ensure-tags/route.ts`.
2. Lock down or disable `src/app/api/seed/postcode/route.ts`.
3. Add provider ownership/admin authorization to `src/app/api/reviews/[providerId]/ai-summary/route.ts`.
4. Add explicit CSRF defenses to cookie-authenticated POST routes.
5. Harden outbound website fetching in `src/lib/provider-ai-tagging.ts`.
6. Add CSP and baseline security headers at app or edge level.
7. Review browser-side auth/session persistence strategy and outbound provider URL handling.
