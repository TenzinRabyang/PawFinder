# PawFinder Breed Categorization Investigation Report

Date: 2026-07-03

## Purpose

This document records the full investigation into why PawFinder is currently not categorizing businesses into supported animal breeds as expected.

The investigation was based on:

- source-code tracing
- live API checks
- live Supabase data checks
- live browser verification
- live server log review

This is an evidence-based report. It does not rely on assumptions where runtime verification was possible.

## Executive Summary

The breed categorization problem is real and is not mainly a frontend display bug.

The main issue happens earlier in the pipeline:

1. Most search results are Google-only businesses and do not exist in `pf_providers`, so breed analysis never starts for them.
2. Some claimed providers already have `ai_tagged_at` saved but still have empty `breeds_specialised`, and the app then wrongly treats them as already analyzed and does not retry.
3. Even when analysis does run, the current website-fetch and DeepSeek flow can still return an empty breed array, especially when useful subpages time out or the site does not explicitly mention breed coverage.

## Scope Of Investigation

The following areas were checked:

- breed taxonomy and normalization
- website content collection for AI analysis
- DeepSeek breed-tagging prompt and response handling
- database persistence of AI tagging results
- retry logic in `ensure-tags`
- claim-time AI tagging
- manual reanalyze flow
- provider profile page loading and breed display logic
- search API enrichment behavior
- live Supabase provider rows
- live browser behavior on provider profiles
- live server logs during a real provider load

## Files Reviewed

- [breed-taxonomy.ts](file:///workspace/src/lib/breed-taxonomy.ts)
- [provider-ai-tagging.ts](file:///workspace/src/lib/provider-ai-tagging.ts)
- [persist-provider-ai-tags.ts](file:///workspace/src/lib/persist-provider-ai-tags.ts)
- [ensure-tags route](file:///workspace/src/app/api/providers/%5Bid%5D/ensure-tags/route.ts)
- [claim route](file:///workspace/src/app/api/business/claim/route.ts)
- [reanalyze route](file:///workspace/src/app/api/business/reanalyze/route.ts)
- [provider profile page](file:///workspace/src/app/provider/%5Bid%5D/page.tsx)
- [search route](file:///workspace/src/app/api/providers/search/route.ts)

## Expected Architecture

The intended behavior appears to be:

1. A provider page opens.
2. If the provider is already stored in `pf_providers`, the app can use saved breed categories.
3. If breed data is missing, the app can analyze the provider website.
4. DeepSeek returns structured AI tags, including `breeds_specialised`.
5. The app saves those tags to the database.
6. The provider profile then displays the saved breed categories.

In practice, this breaks in multiple places.

## Confirmed Findings

### Finding 1: Google-only providers cannot be breed-tagged

This is one of the biggest causes of the problem.

Evidence:

- A real search request was made:
  - `GET /api/providers/search?postcode=S10 1BD&category=vet`
- The route returned 20 providers.
- The first result was:
  - `Broomhill Veterinary Practice`
  - `google_place_id = ChIJHS280HSCeUgRfJjL3lY_Kw0`
- That result had:
  - `breeds_specialised: []`
- A live Supabase lookup for that Google place id returned no matching row in `pf_providers`.

Then the app’s own tagging route was tested for that same provider:

- `POST /api/providers/ChIJHS280HSCeUgRfJjL3lY_Kw0/ensure-tags`
- Result:
  - HTTP `404`
  - Error: `Provider must exist in the database before tags can be refreshed`

This matches the route logic in [ensure-tags route](file:///workspace/src/app/api/providers/%5Bid%5D/ensure-tags/route.ts#L47-L53).

The provider profile page also only attempts live tag refresh when a DB row exists:

- `else if (prov?.id && providerWebsite) { ... }`

See [provider profile page](file:///workspace/src/app/provider/%5Bid%5D/page.tsx#L239-L243).

Meaning:

- If a provider is only a Google search result and has never been claimed or inserted into `pf_providers`, breed analysis does not run.
- This makes breed categorization unavailable for most ordinary search results.

### Finding 2: Empty breed results can become permanently stuck

This is the second major cause.

Evidence from live Supabase:

- A stored provider row was found:
  - `GoVets - Manchester`
  - `google_place_id = ChIJVcPPCgSxe0gRHDcaTXQEBTE`
- The row had:
  - `ai_tagged_at` set
  - `animals_served` populated
  - `services` populated
  - `breeds_specialised` still empty

Then the tagging refresh route was called:

- `POST /api/providers/ChIJVcPPCgSxe0gRHDcaTXQEBTE/ensure-tags`

The route returned:

- `source: "database"`
- the previously stored provider row
- still `breeds_specialised: []`

This proves the app is not retrying analysis for that provider.

Why this happens:

- `hasSavedWebsiteAnalysis()` in [ensure-tags route](file:///workspace/src/app/api/providers/%5Bid%5D/ensure-tags/route.ts#L8-L17) checks whether analysis is considered already done.
- If that function returns true, the route exits early at [ensure-tags route](file:///workspace/src/app/api/providers/%5Bid%5D/ensure-tags/route.ts#L56-L58).
- On the profile page, the same state is treated as final:
  - if saved analysis exists and breeds are still empty, `breedTagStatus` becomes `'unavailable'`
  - see [provider profile page](file:///workspace/src/app/provider/%5Bid%5D/page.tsx#L231-L245)

Meaning:

- A provider can be analyzed once,
- get empty `breeds_specialised`,
- and then never be automatically reanalyzed again.

### Finding 3: DeepSeek is really returning empty breed arrays for some real providers

This was verified directly.

The current website-analysis prompt was reproduced against the real provider website:

- `https://govets.co.uk/`

DeepSeek returned:

```json
{
  "animals_served": ["dog", "cat", "rabbit"],
  "services": ["veterinary", "surgery", "dental", "microchipping", "vaccinations", "neutering", "x ray", "orthopaedic surgery", "soft tissue surgery", "palliative care", "travel"],
  "breeds_specialised": [],
  "has_online_booking": false
}
```

This proves the empty breeds are not just caused by frontend rendering or database save failure.

In this tested case:

- the AI itself returned no breeds.

Meaning:

- even when analysis runs successfully,
- the current prompt and available site content can still produce no breed categories.

### Finding 4: Important website subpages are timing out during analysis

The live server logs showed:

- failed to fetch extra page `https://govets.co.uk/clinical-services/`
- failed to fetch extra page `https://govets.co.uk/pet-care-hub/`
- both failed with timeout

This matches the `2500ms` timeout in [provider-ai-tagging.ts](file:///workspace/src/lib/provider-ai-tagging.ts#L148-L156).

The same logs also showed:

- `originalCharCount: 9734`
- `truncatedCharCount: 3000`
- `skippedLowContent: false`

Meaning:

- the system had more than enough content overall,
- but the final AI context was still limited to the first `3000` characters,
- and some slower but potentially important subpages never made it into the prompt at all.

Impact:

- breed signals that live deeper in service pages or FAQ pages may be missed,
- especially on slower WordPress-style sites.

### Finding 5: The profile UI is behaving consistently with the saved data

The provider page for `GoVets - Manchester` was opened in the browser.

Observed sequence:

1. Initial loading state showed:
   - `Loading profile...`
   - `We are saving breed categories from the business website before opening the profile.`
2. The page then completed loading.
3. The “Breeds Supported” section displayed:
   - `Breed coverage could not be confirmed from the business website.`
4. There were no browser console errors.

Meaning:

- the frontend is not crashing,
- the UI is showing the fallback state because no saved breeds were available.

### Finding 6: Live database schema is not fully aligned with current code

A live query for the field `ai_tagging_skipped_low_content` failed with:

- `column pf_providers.ai_tagging_skipped_low_content does not exist`

This does not appear to be the main root cause of the breed problem because the app currently has fallback handling in [persist-provider-ai-tags.ts](file:///workspace/src/lib/persist-provider-ai-tags.ts#L15-L56).

However, it proves that the live Supabase table is behind the codebase in at least one area.

Impact:

- debugging becomes harder,
- metadata tracking is incomplete,
- future AI tagging behavior may be less predictable.

## Root Cause Analysis

### Primary Root Cause

Breed analysis is currently limited to providers that already exist in `pf_providers`.

Most live search results are Google-only results that have not been claimed and are not stored in the database yet.

Therefore:

- the provider profile can open,
- but breed analysis has no stored provider record to work with,
- and the `ensure-tags` route rejects the request.

### Secondary Root Cause

The app treats `ai_tagged_at` as proof that breed analysis is already complete, even when:

- `breeds_specialised` is empty
- `animals_served` may be incomplete
- the earlier AI result may have been weak or low-confidence

Therefore:

- empty breed results can become sticky,
- and the system stops trying too early.

### Tertiary Root Cause

The AI input is often incomplete or not explicit enough for breed extraction:

- extra pages time out
- only `3000` characters are sent to DeepSeek
- some sites mention species generally but do not explicitly list breed coverage
- the prompt only fills all breeds when the wording is very explicit

Therefore:

- even valid businesses can end up with empty breed arrays.

## What Is Not The Main Root Cause

### Not Mainly A Frontend Bug

The UI renders the breed data correctly when present.

The fallback message appears because saved breed data is empty, not because rendering is broken.

### Not Mainly A Database Write Failure

In the tested `GoVets` case:

- AI tag persistence clearly worked for `animals_served` and `services`,
- so saving itself is not the main failure,
- the problem is that `breeds_specialised` remained empty and then was treated as final.

### Not Mainly Breed Normalization

The taxonomy is strict and may exclude some non-standard labels, but in the tested live case DeepSeek already returned `[]` before normalization was even a factor.

So normalization may be a secondary limiter, but it is not the primary confirmed failure here.

## Impact On The App

### Search Results

- Most businesses shown in search remain without breed categories.
- Breed-based filtering becomes weak or incomplete.

### Provider Profiles

- Users see fallback messages instead of real breed coverage.
- This reduces trust in the differentiating AI-tagging feature.

### Claimed Businesses

- A business can be analyzed once and remain stuck with empty breed coverage until manually fixed.

### Product Differentiation

- The platform’s claim of breed-specific support is weakened when coverage tags are usually absent.

## Real Examples Verified During Investigation

### Example 1: Google-Only Result

Provider:

- `Broomhill Veterinary Practice`
- Place ID: `ChIJHS280HSCeUgRfJjL3lY_Kw0`

Verified outcome:

- appears in search
- does not exist in `pf_providers`
- cannot use `ensure-tags`
- has no saved breed categories

### Example 2: Stored Claimed Provider With Empty Breeds

Provider:

- `GoVets - Manchester`
- Place ID: `ChIJVcPPCgSxe0gRHDcaTXQEBTE`

Verified outcome:

- exists in `pf_providers`
- has `ai_tagged_at`
- has populated `animals_served`
- has populated `services`
- still has empty `breeds_specialised`
- `ensure-tags` returns database row without re-running analysis
- profile page shows fallback breed message

## Recommended Fixes

### Fix 1: Allow breed analysis for Google-only profile pages

When a user opens a Google-only provider profile:

- create or upsert a minimal `pf_providers` row first
- then run website analysis
- then save breed tags to that row

Without this change, most search results will never get breed categories.

### Fix 2: Change retry logic for empty breed results

Do not treat `ai_tagged_at` alone as success.

Retry analysis when:

- `breeds_specialised` is empty
- or `animals_served` is empty
- or prior analysis was marked low-content

This is the most important fix for already-claimed businesses that are stuck with empty breed results.

### Fix 3: Improve the website-fetch phase

Suggested improvements:

- increase timeout for extra relevant pages
- prioritize pages likely to contain animal or breed coverage
- allow one or two additional relevant subpages for better AI context

This should improve breed detection quality without changing the whole architecture.

### Fix 4: Improve the AI prompt fallback rule

The current prompt is conservative.

For many businesses, especially general vets and groomers, the site may imply:

- support for dogs in general
- support for cats in general
- support for rabbits or small mammals

without listing every breed explicitly.

The prompt should be improved to safely infer broader breed coverage when the business clearly serves that animal generally.

### Fix 5: Align live schema with code

Bring the live Supabase table in line with the current app fields, including:

- `ai_tagging_skipped_low_content`

This is not the main breed bug, but it improves reliability and observability.

## Priority Order

Recommended implementation priority:

1. Fix Google-only provider analysis
2. Fix empty-breed retry logic
3. Improve website subpage collection and timeout behavior
4. Improve prompt fallback for general animal support
5. Align live schema with code

## Final Conclusion

The breed categorization issue is caused by a combination of architectural and logic problems, not a single bug.

The two most important confirmed failures are:

1. breed analysis does not run for Google-only providers because they do not exist in `pf_providers`
2. providers with empty `breeds_specialised` can be treated as already analyzed and are not retried

There is also a third confirmed quality issue:

- even when analysis runs, DeepSeek may still return empty breeds because the current website context and prompt are too limited for some businesses

In short:

- the system is partially working,
- but the current logic prevents it from working reliably for most real provider pages.

## Suggested Next Action

The next best engineering step is:

1. make provider profile opening create or upsert a minimal provider record for Google-only results
2. change the retry logic so empty `breeds_specialised` triggers reanalysis
3. retest the full flow on both a Google-only provider and a claimed provider already stuck with empty breeds
