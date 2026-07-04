# ensure-tags Spot-Check Report

## Purpose

This report documents a live runtime spot-check of the `ensure-tags` trigger path for provider profile pages.

It was created to verify the opposite path from the already-confirmed Broomhill case:

- Broomhill proved the app correctly skips `ensure-tags` when a provider already has good saved breed data.
- This report checks whether `ensure-tags` actually fires and enriches providers that genuinely need it.

## Candidate Selection

Three target states were requested:

1. Never tagged
2. Previously stuck, pre-fix
3. Partially tagged, under retry cap

### Real candidates found

#### Candidate 1: Never tagged / Google-only

- Name: `Crosspool Pet Supplies`
- `google_place_id`: `ChIJd9UPPweCeUgRTm16uDeJF2w`
- Status before test:
  - no `pf_providers` row existed
  - this was a true Google-only provider profile

#### Candidate 2: Previously stuck / pre-fix leftover

- Name: `GoVets - Manchester`
- `google_place_id`: `ChIJVcPPCgSxe0gRHDcaTXQEBTE`
- Status before test:
  - existing `pf_providers` row
  - `ai_tagged_at` already set
  - `breeds_specialised = []`
  - `breeds_general_inferred = []`
  - `tagging_attempt_count = 0`

#### Candidate 3: Partially tagged, under retry cap, still missing both breed arrays

- No real example currently exists in the live database.
- A direct database query for providers with:
  - `tagging_attempt_count IN (1, 2)`
  - `breeds_specialised = []`
  - `breeds_general_inferred = []`
  returned no rows.

No fabricated case was created.

## Temporary Runtime Instrumentation

Temporary console logging was added to `src/app/provider/[id]/page.tsx` during the trace and then removed afterward.

The logging captured:

- which branch was taken:
  - `existing_row`
  - `fallback_temporary_object`
- the `google_place_id`
- current `breeds_general_inferred`
- current `breeds_specialised`
- whether `ensure-tags` was called
- the `ensure-tags` response body when present
- whether `setProvider(...)` ran with enriched data

The temporary logging was removed after diagnosis, and the app was rebuilt successfully.

## Candidate 1 Trace

### Candidate

- Category: never tagged / Google-only
- Provider: `Crosspool Pet Supplies`
- `google_place_id`: `ChIJd9UPPweCeUgRTm16uDeJF2w`

### Expected behavior

The profile page should:

1. load a temporary fallback provider object
2. call `ensure-tags`
3. create a `pf_providers` row
4. enrich the row from website analysis
5. update the UI away from the fallback display

### Console evidence

The browser console showed:

```text
[provider-page] resolved provider branch {
  "placeId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "source":"fallback_temporary_object",
  "providerId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "googlePlaceId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "services":[],
  "breedsGeneralInferred":[],
  "breedsSpecialised":[]
}
```

```text
[provider-page] analysis gating {
  "placeId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "currentAnalysisStatus":"retrying",
  "shouldRefreshBreedCoverage":false,
  "providerWebsitePresent":true
}
```

```text
[provider-page] ensure-tags request start {
  "placeId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "website":"https://m.facebook.com/crosspoolpetsupplies",
  "baseProviderId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "baseProviderGooglePlaceId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "baseBreedsGeneralInferred":[],
  "baseBreedsSpecialised":[],
  "providerWebsitePresent":true
}
```

```text
[provider-page] setProvider initial {
  "placeId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "source":"fallback_temporary_object",
  "providerId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "googlePlaceId":"ChIJd9UPPweCeUgRTm16uDeJF2w",
  "breedsGeneralInferred":[],
  "breedsSpecialised":[]
}
```

### Network evidence

The browser network log showed:

- `GET /api/providers/ChIJd9UPPweCeUgRTm16uDeJF2w/live-details` -> `200`
- Supabase `pf_providers` lookup -> `200`
- `POST /api/providers/ChIJd9UPPweCeUgRTm16uDeJF2w/ensure-tags` -> `500`

This confirms `ensure-tags` did fire.

### Raw `ensure-tags` response body

Direct API check returned:

```json
{"error":"invalid input value for enum pf_provider_category: \"pet_care\""}
```

### Server-side evidence

After the failed request, a direct DB check confirmed:

- no `pf_providers` row existed yet for `ChIJd9UPPweCeUgRTm16uDeJF2w`

### Visual result

The UI stayed on the fallback display:

- `Service Categories` showed only `Pet Care`
- `Breeds Supported` showed:
  - `We're still gathering breed info for this business.`

### Rough timing

- Trigger fired immediately on page load
- After about 4 seconds, the page was still on fallback UI because the backend request had failed

### Conclusion

For a true Google-only provider:

- `ensure-tags` does trigger as expected
- but the path currently fails on first row creation
- root failure:

```text
invalid input value for enum pf_provider_category: "pet_care"
```

This is a real backend bug in the first-time Google-only provider creation path.

## Candidate 2 Trace

### Candidate

- Category: previously stuck / pre-fix leftover
- Provider: `GoVets - Manchester`
- `google_place_id`: `ChIJVcPPCgSxe0gRHDcaTXQEBTE`

### Expected behavior

The profile page should:

1. load the existing `pf_providers` row
2. detect it still needs breed refresh
3. call `ensure-tags`
4. save enriched breed coverage
5. re-render the UI with the updated data

### Console evidence

The browser console showed:

```text
[provider-page] resolved provider branch {
  "placeId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "source":"existing_row",
  "providerId":"828ad5b6-6bfa-4451-b30f-d0889ffc9b6c",
  "googlePlaceId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "services":["vaccinations","microchipping","dental_care","neutering"],
  "breedsGeneralInferred":[],
  "breedsSpecialised":[]
}
```

```text
[provider-page] analysis gating {
  "placeId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "currentAnalysisStatus":"confirmed",
  "shouldRefreshBreedCoverage":true,
  "providerWebsitePresent":true
}
```

```text
[provider-page] ensure-tags request start {
  "placeId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "website":"https://govets.co.uk/",
  "baseProviderId":"828ad5b6-6bfa-4451-b30f-d0889ffc9b6c",
  "baseProviderGooglePlaceId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "baseBreedsGeneralInferred":[],
  "baseBreedsSpecialised":[],
  "providerWebsitePresent":true
}
```

```text
[provider-page] ensure-tags response {
  "placeId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "ok":true,
  "source":"generated",
  "analysisStatus":"confirmed",
  "responseBreedsGeneralInferred":["dog","cat"],
  "responseBreedsSpecialised":[],
  "responseTaggingAttemptCount":1,
  "rawResponseBody":{ ... }
}
```

```text
[provider-page] setProvider from ensure-tags {
  "placeId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "mergedProviderId":"828ad5b6-6bfa-4451-b30f-d0889ffc9b6c",
  "mergedProviderGooglePlaceId":"ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "mergedBreedsGeneralInferred":["dog","cat"],
  "mergedBreedsSpecialised":[]
}
```

### Network evidence

The browser network log showed:

- `GET /api/providers/ChIJVcPPCgSxe0gRHDcaTXQEBTE/live-details` -> `200`
- Supabase `pf_providers` lookup -> `200`
- Supabase `pf_reviews` lookup -> `200`
- `POST /api/providers/ChIJVcPPCgSxe0gRHDcaTXQEBTE/ensure-tags` -> `200`

### Raw `ensure-tags` response body highlights

The response returned:

- `source: "generated"`
- `analysis_status: "confirmed"`
- `breeds_general_inferred: ["dog", "cat"]`
- `breeds_specialised: []`
- `tagging_attempt_count: 1`
- `pages_analysed: 3`
- `pages_attempted: 3`
- `pages_fetched: 3`

### Visual result

The UI updated correctly after enrichment.

The page displayed:

- service categories expanded beyond the original sparse set
- `Breeds Supported`
  - `Generally treats: Dogs`
  - `Generally treats: Cats`
  - `Animals confirmed`
    - `Dogs`
    - `Cats`

### Rough timing

Using the browser console timestamps:

- `ensure-tags request start`: `1783109206716`
- `ensure-tags response`: `1783109215572`

Elapsed time: about **8.9 seconds**

### Database state after run

Direct DB verification showed:

```json
{
  "google_place_id": "ChIJVcPPCgSxe0gRHDcaTXQEBTE",
  "name": "GoVets - Manchester",
  "category": "vet",
  "ai_tagged_at": "2026-07-03T20:06:54.958+00:00",
  "tagging_attempt_count": 1,
  "breed_analysis_exhausted": false,
  "ai_tagging_skipped_low_content": false,
  "breeds_specialised": [],
  "breeds_general_inferred": ["dog", "cat"],
  "animals_served": ["dog", "cat"],
  "services": [
    "vaccination",
    "microchipping",
    "dental_care",
    "orthopaedic_surgery",
    "x-ray",
    "cardiology",
    "soft_tissue_surgery",
    "neutering",
    "palliative_care",
    "health_care_plan"
  ],
  "is_claimed": true
}
```

### Conclusion

For a previously stuck saved provider:

- `ensure-tags` fired as expected
- enrichment succeeded
- the database updated correctly
- the React UI re-rendered correctly

This path is working.

## Candidate 3 Result

### Candidate

- Category: partially tagged, under retry cap, still missing both breed arrays
- Real example found: none

### Outcome

No direct runtime trace was possible for this category because the live database currently has no provider matching:

- `tagging_attempt_count IN (1, 2)`
- `breeds_specialised = []`
- `breeds_general_inferred = []`

### Retry cap verification

Because no real provider matched this state, this report does not claim full live verification of:

- increment from attempt 2 to attempt 3
- automatic setting of `breed_analysis_exhausted = true`
- suppression of subsequent automatic `ensure-tags` calls after exhaustion

That remains unverified in live runtime for this specific category.

## Overall Findings

### Proven working

1. Already-good providers can skip `ensure-tags` safely (confirmed earlier via Broomhill).
2. Stale existing providers missing breed coverage can re-trigger `ensure-tags`, save enriched data, and update the UI correctly (`GoVets - Manchester`).

### Proven broken

1. Google-only providers that need first-time row creation do trigger `ensure-tags`, but currently fail during provider creation because:

```text
invalid input value for enum pf_provider_category: "pet_care"
```

This prevents first-time enrichment and leaves the UI stuck on the fallback display.

## Final Summary

The spot-check closes the confidence gap on both sides of the system:

- the "skip when already good" path works
- the "refresh an existing stale row" path works

But it also exposed a real unresolved issue:

- the "first-time Google-only provider creation" path is broken by a backend enum/category mismatch

## Logging Cleanup

Temporary trace logging was removed after diagnosis.

The app was rebuilt successfully after cleanup.
