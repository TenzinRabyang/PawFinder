# Location Search Diagnosis

## Diagnosis

- No fix applied.
- The selected-suggestion branch in `handleSearch()` sends `location`, `lat`, and `lng`, not `postcode`.
- `src/app/api/providers/search/route.ts` expects `postcode` and does not accept `lat`/`lng`.
- But the lat/lng flow is not supposed to hit that route. `src/app/search/page.tsx` explicitly switches to `/api/providers/search-by-location` when `lat` and `lng` are present.
- So there is a real param mismatch if you compare the selected-location branch to `route.ts`, but it is an intentional mismatch because that branch is meant for `search-by-location`, not `route.ts`.

## Actual Captured Payloads

- I added the requested logging in `handleSearch()`, plus an equivalent persisted breadcrumb so I could recover the exact runtime payload after navigation.
- Selected suggestion runtime payload captured:

```json
{
  "pawfinderLastHandleSearchSubmit": {
    "path": "selected-location",
    "selectedLocation": {
      "description": "Sheffield, UK",
      "place_id": "ChIJFb7o-qkKeUgReLAGr_UnKD4",
      "lat": 53.38112899999999,
      "lng": -1.470085
    },
    "searchUrl": "/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085"
  }
}
```

- Postcode runtime payload captured:

```json
{
  "pawfinderLastHandleSearchSubmit": {
    "path": "postcode",
    "postcodeInput": "S10 1BD",
    "normalizedInput": "S101BD",
    "searchUrl": "/search?postcode=S101BD"
  }
}
```

## Browser Trace

- Selected suggestion path actual navigation:

```text
Before: http://localhost:3011/
After:  http://localhost:3011/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085
```

- Postcode path actual navigation:

```text
Before: http://localhost:3011/
After:  http://localhost:3011/search?postcode=S101BD
```

## What route.ts Expects

- `src/app/api/providers/search/route.ts` reads:
  - `postcode`
  - optional `category`
  - optional `animal`
  - optional `service`
  - optional `breed`
  - optional `forceRefresh`
- It then enforces:
  - `postcode` must exist
  - `postcode` must match a full UK postcode regex

## What The Search Page Actually Calls

- In `src/app/search/page.tsx`:
  - if `selectedLat && selectedLng`, request URL becomes:

```text
/api/providers/search-by-location?lat=...&lng=...&location=...
```

  - otherwise it becomes:

```text
/api/providers/search?postcode=...
```

- I captured the working postcode-side fetch log:

```json
{
  "requestUrl": "/api/providers/search?postcode=S101BD"
}
```

- I also captured the browser network for postcode showing:

```text
GET /api/providers/search?postcode=S101BD -> 200
```

## Important Finding

- For the selected-location path, the browser reached:

```text
/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085
```

- But instead of the search page initializing and then fetching `search-by-location`, the browser showed:

```json
{"error":"failed to build request"}
```

- That means the failure is happening before the normal client-side results fetch finishes.
- I directly called the intended lat/lng API with the same params:

```text
/api/providers/search-by-location?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085
```

- That direct call returned provider JSON successfully.
- So the evidence does not support "`handleSearch()` is sending the wrong params to `route.ts`" as the root cause.

## Bottom Line

- Postcode path:
  - sends `/search?postcode=S101BD`
  - search page calls `/api/providers/search?postcode=S101BD`
  - works
- Selected suggestion path:
  - sends `/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085`
  - intended downstream API is `/api/providers/search-by-location`
  - direct API call works
  - browser still hits `{"error":"failed to build request"}` before the normal page flow completes
- Conclusion:
  - `handleSearch()` selected-location branch is not sending the param shape that `route.ts` expects
  - but that is by design, because it is meant for `search-by-location`
  - the current bug is not explained by a simple `lat/lng` vs `postcode` mismatch with `src/app/api/providers/search/route.ts`

