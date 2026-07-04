# Failed To Build Request Source Diagnosis

## Summary

- The literal string `"failed to build request"` does not exist anywhere in the app source.
- It also does not exist in `node_modules`, including the installed `next` package.
- That means the error is not being thrown or returned by any application route handler in this repository.

## Search Results

- Searched the entire workspace for:
  - `"failed to build request"`
  - `"Failed to build request"`
  - `"build request"`
- Result: no matching app source or framework source containing that exact message.

## Closest Relevant Code

- The selected-location flow is built in `src/app/page.tsx`.
- The results-page fetch logic is in `src/app/search/page.tsx`.
- The earliest app entrypoint for incoming requests is `src/middleware.ts`.
- The closest Next internal request-construction code is `node_modules/next/dist/server/web/spec-extension/adapters/next-request.js`.

## Trigger Condition Checked

- I added temporary tracing around the Next request adapter's `new NextRequest(...)` construction path.
- I then re-triggered the selected-suggestion flow and checked server logs.
- Result: the temporary adapter trace never fired during the failing browser navigation.
- I also checked `src/middleware.ts`, which already logs every request at entry.
- Result: no middleware log appeared for the failing selected-location browser navigation either.

## Actual Captured Runtime Data

### Selected-suggestion submission payload captured earlier

```json
{
  "path": "selected-location",
  "selectedLocation": {
    "description": "Sheffield, UK",
    "place_id": "ChIJFb7o-qkKeUgReLAGr_UnKD4",
    "lat": 53.38112899999999,
    "lng": -1.470085
  },
  "searchUrl": "/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085"
}
```

### Failing browser navigation

```text
Before: http://localhost:3011/
After:  http://localhost:3011/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085
```

### Browser-visible failure

```json
{"error":"failed to build request"}
```

### What did NOT happen during that failing navigation

- No log from `src/middleware.ts`
- No log from temporary tracing in Next's request adapter
- No normal `search/page.tsx` client log sequence for the selected-location path

That means the failure happened before the request reached our app code.

## Control Test

I sent the exact same URL directly to the local Next server with `curl`:

```text
http://localhost:3011/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085
```

That request succeeded with `200 OK`, and the app did receive it.

### Captured server log from direct local request

```text
[middleware] start {
  url: 'http://localhost:3011/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085',
  pathname: '/search',
  method: 'GET',
  host: 'localhost:3011',
  xForwardedHost: 'localhost:3011',
  xForwardedProto: 'http',
  origin: null,
  referer: null,
  secFetchSite: null,
  hasSupabaseUrl: true,
  hasAnonKey: true
}
```

This proves the selected-location URL itself is valid for the app.

## Conclusion

- File/line throwing `"failed to build request"`: not found in this codebase.
- Triggering condition observed: occurs only in the browser/preview path, before the request reaches app middleware or Next request-construction inside this repo.
- Actual captured data at failure:
  - URL being navigated to was valid:
    - `/search?location=Sheffield%2C+UK&lat=53.38112899999999&lng=-1.470085`
  - App entry logs were absent during failure
  - Same URL succeeded when sent directly to the local app server

## Best Current Diagnosis

The `"failed to build request"` error is almost certainly coming from an external preview/browser proxy layer that sits in front of the local app server, not from the PawFinder app code or its two backend search routes.

## Cleanup Performed

- Removed the temporary Next internal request-adapter tracing after capturing the result.
- Removed the temporary `window.name` breadcrumb used only for the earlier payload capture.
- Kept the explicit `handleSearch()` console logging requested in the earlier diagnosis pass.

