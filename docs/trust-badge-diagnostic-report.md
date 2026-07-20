# Trust Badge Diagnostic Report

## Root Cause Analysis
- The trust badge did not render because the profile page only displayed the trust UI when `trustSnapshot` was populated in client state.
- In [page.tsx](file:///workspace/src/app/provider/[id]/page.tsx), the badge render guard was:
  - `trustSnapshot ? <TrustBadge ... /> : null`
- That means any failure in the secondary trust fetch left the entire trust section invisible.
- The main pipeline break was in [trust-snapshot/route.ts](file:///workspace/src/app/api/providers/[id]/trust-snapshot/route.ts):
  - the route previously returned `404` when no `pf_providers` row existed
  - many provider pages can still render from live Google data even when no persisted `pf_providers` row exists
  - for those providers, the trust route failed and `trustSnapshot` stayed `null`
- The failure was effectively silent in the UI because the `try...catch` in [page.tsx](file:///workspace/src/app/provider/[id]/page.tsx) logged the error but still rendered nothing for the trust section.

## Table & Column Verification
- The app is correctly targeting the `pf_providers` table, not `providers`.
- Verified references:
  - [schema.sql](file:///workspace/schema.sql)
  - [page.tsx](file:///workspace/src/app/provider/[id]/page.tsx)
  - [trust-snapshot/route.ts](file:///workspace/src/app/api/providers/[id]/trust-snapshot/route.ts)
- The provider page currently fetches the base provider row with `select('*')`, so if the new columns exist in Supabase they are included in the row automatically.
- The trust snapshot route explicitly selects:
  - `id`
  - `google_place_id`
  - `name`
  - `trust_badge`
  - `audit_reason`
  - `safety_flags`
  - `highlights`
  - `ai_version`
- Conclusion:
  - there is no TypeScript-side table name mismatch
  - the likely live failure was not caused by missing selected columns on the primary provider fetch
  - the break was caused by the trust route requiring a persisted `pf_providers` row before returning any trust payload

## Rendering Guard Assessment
- The trust UI was hidden unless `trustSnapshot` existed.
- This affected all trust states, including `GRAY`.
- `GRAY` was not explicitly hidden by a badge-value condition; it was hidden indirectly because `trustSnapshot` never got set.
- Before the fix:
  - no saved trust data -> route fetch attempted
  - route returned `404` or failed
  - catch block logged an error
  - UI stayed `null`
- Result:
  - no trust badge
  - no audit summary
  - no highlights

## Environment & API Key Assessment
- [trust-eval.ts](file:///workspace/src/lib/trust-eval.ts) throws when neither `DEEPSEEK_API_KEY` nor `OPENAI_API_KEY` exists.
- [createAdminClient()](file:///workspace/src/utils/supabase/admin.ts) throws if `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing.
- Those throws are contained by the route-level `try...catch` in [trust-snapshot/route.ts](file:///workspace/src/app/api/providers/[id]/trust-snapshot/route.ts), which returns JSON `500`.
- On the page side, the trust fetch was previously caught but not surfaced to the user, which again led to invisible UI.

## Added Diagnostics
- Added server logs in [trust-snapshot/route.ts](file:///workspace/src/app/api/providers/[id]/trust-snapshot/route.ts):
  - `[Trust Engine] Provider DB Row fetched:`
  - `[Trust Engine] AI Version check result:`
  - `[Trust Engine] API Refresh status code and payload:`
- Added client logs in [page.tsx](file:///workspace/src/app/provider/[id]/page.tsx):
  - `[Trust Engine] Provider DB Row fetched:`
  - `[Trust Engine] AI Version check result:`
  - `[Trust Engine] API Refresh status code and payload:`

## Proposed Fix Plan
1. Keep using `pf_providers` as the canonical cache table.
2. Update the trust snapshot route so it can still analyze Google-backed provider pages when no `pf_providers` row exists yet.
3. Return a usable trust payload even for non-persisted providers instead of `404`.
4. Keep DB caching behavior for persisted providers:
   - if `ai_version >= 2`, return cached values
   - if stale, recompute and persist `ai_version = 2`
5. Add a visible fallback state in the provider page:
   - show a temporary `GRAY` trust badge with a loading message while trust analysis is running
   - show a visible fallback message if trust analysis fails

## Implemented Fix
- Updated [trust-snapshot/route.ts](file:///workspace/src/app/api/providers/[id]/trust-snapshot/route.ts):
  - no longer hard-fails when there is no `pf_providers` row but a place id is available
  - evaluates Google review text for Google-only providers
  - persists trust results only when a real `pf_providers` row exists
  - returns `GRAY` fallback if no review text is available
- Updated [page.tsx](file:///workspace/src/app/provider/[id]/page.tsx):
  - immediately shows a fallback/loading trust state when the cache is stale or missing
  - logs trust fetch results
  - shows a visible fallback message instead of hiding the trust section entirely

## Expected Result After Fix
- Provider pages with cached trust data show the trust badge immediately.
- Provider pages without cached trust data show a visible loading/fallback trust state first.
- Google-only providers no longer lose the trust UI just because they are not yet persisted in `pf_providers`.
