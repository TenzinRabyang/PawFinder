# PawFinder Build Report

## 1. Executive Summary
PawFinder is a UK-focused pet services directory web application designed to help pet owners discover nearby providers such as vets, groomers, walkers, kennels, pet shops, trainers, sitters, and mobile pet services. The product is intentionally differentiated from generic directories by combining live location-based discovery with native breed- and temperament-aware reviews written by real users.

The current build uses a hybrid architecture:
- live discovery and lightweight enrichment from Google Places and Postcodes.io
- persistent project-specific data stored in Supabase
- AI-assisted categorisation and summarisation through DeepSeek
- a Next.js App Router frontend and backend in a single codebase

The application is now functionally capable of:
- validating and searching by full UK postcode
- fetching nearby providers from Google Places
- caching search results to reduce external API cost
- merging live Google data with platform-native Supabase data
- showing provider profile pages with reviews, categories, breed tags, phone popup, and open/closed state
- allowing businesses to claim listings
- saving AI-generated breed and service tagging into the database
- generating and storing AI summaries for native reviews

## 2. Product Aim
The product aim is to build a trusted pet-services search platform that gives pet owners information they cannot easily get from generic search products.

Core intent:
- help users find relevant pet care providers near a postcode
- make provider selection more informed through breed-specific and temperament-specific review data
- reduce operational cost by avoiding unnecessary storage of restricted Google data
- create a path for business verification and future monetisation

## 3. Business Objectives
- Build a mobile-friendly UK pet directory.
- Preserve legal/compliance boundaries around Google Places data.
- Use project-owned data as the product differentiator.
- Keep Google usage cost-controlled with caching and limited live enrichment.
- Create a future path for paid verification and subscriptions.
- Support claimed business profiles with richer categorisation and visibility.

## 4. User Objectives
### 4.1 Pet Owners
- Search by postcode.
- Filter by category and breed.
- See nearest providers first.
- Read structured temperament reviews.
- Understand whether a business is open now.
- Access website, booking, and phone details easily.

### 4.2 Business Owners
- Claim a listing.
- Associate the listing with their account.
- Run AI website analysis to save categories and breed support.
- Manage subscription status over time.

### 4.3 Admin / Operators
- Seed provider data for postcode areas.
- Inspect search and auth logs during debugging.
- Maintain cache performance and daily cleanup.

## 5. Current Technology Stack
- Frontend framework: Next.js 16 App Router
- Runtime UI library: React 19
- Styling: Tailwind CSS 4
- Database/Auth/Storage: Supabase
- Payments: Stripe
- Live business discovery: Google Places API
- Postcode geocoding: Postcodes.io
- AI categorisation and summarisation: DeepSeek
- Icons: `lucide-react`

Key package metadata is defined in [package.json](file:///workspace/package.json).

## 6. High-Level Architecture
PawFinder uses a backend-for-frontend model inside Next.js:
- client pages render UI and call internal route handlers
- route handlers orchestrate Supabase plus third-party APIs
- Supabase stores only platform-owned or project-specific data
- Google data is fetched live where appropriate instead of being permanently stored

### 6.1 Main Layers
1. Presentation layer
   - Home page
   - Search results page
   - Provider profile page
   - Business dashboard
   - Pricing page
   - Admin seed page

2. Application layer
   - search route handlers
   - review submission
   - AI summary generation
   - claim flow
   - breed tagging flow
   - Stripe checkout

3. Data layer
   - Supabase tables prefixed with `pf_`
   - Supabase auth for users and business owners
   - Supabase storage bucket for future business photo uploads

4. External services layer
   - Google Places Nearby Search
   - Google Place Details
   - Google Place Photos
   - Postcodes.io
   - DeepSeek chat completions
   - Stripe Checkout

## 7. Current Route Map
### 7.1 App Pages
- `/`
- `/search`
- `/provider/[id]`
- `/business/dashboard`
- `/business/subscribe`
- `/admin/seed`
- `/login`

### 7.2 API Routes
- `/api/providers/search`
- `/api/providers/[id]/live-details`
- `/api/providers/[id]/ensure-tags`
- `/api/business/claim`
- `/api/business/reanalyze`
- `/api/reviews`
- `/api/reviews/[providerId]/ai-summary`
- `/api/seed/postcode`
- `/api/stripe/checkout`
- `/auth/callback`
- `/auth/signout`

## 8. Frontend Implementation
### 8.1 Home Page
Implemented in [page.tsx](file:///workspace/src/app/page.tsx).

Features:
- postcode search hero
- strict UK postcode validation
- postcode normalization before navigation
- warm brand styling with neutral palette
- quick entry links for pet types

Important behavior:
- accepts only full UK postcodes
- removes spaces for URL stability before pushing to search

Key method:
- `handleSearch()`

### 8.2 Search Page
Implemented in [page.tsx](file:///workspace/src/app/search/page.tsx).

Features:
- search param driven state
- sidebar filtering
- category filtering
- breed filtering from shared taxonomy
- simplified result cards
- nearest-match highlighting
- distance display
- featured first result behavior
- image fallback handling for Google photo references
- explicit distinction between Google rating and platform-native rating

Key methods:
- `fetchProviders()`
- `handleFilterChange()`
- `getPrimaryTags()`

UX behavior:
- filters initialize from URL query params
- postcode load triggers search automatically
- manual filter changes can be applied with the button
- result cards link to profile pages
- featured result can carry `?featured=1`

### 8.3 Provider Profile Page
Implemented in [page.tsx](file:///workspace/src/app/provider/[id]/page.tsx).

Features:
- provider profile header
- Google photo cover for eligible profiles
- open/closed state
- service categories
- saved breed support grouped by animal
- AI temperament summary
- native review section
- Google review preview for featured result
- call popup with copy-to-clipboard
- website and booking buttons
- claim CTA for unverified providers
- on-demand breed tag generation when saved tags are missing
- polished loading state while breed tagging is being generated

Key methods:
- `fetchData()`
- `submitReview()`
- `toggleTag()`
- `handleCopyNumber()`
- `normalizeExternalUrl()`
- `getDisplayPhoneNumber()`
- `formatCategoryLabel()`
- `formatServiceLabel()`
- `getReviewAverage()`
- `getReviewerInitials()`

Current review design:
- native reviews are now rendered as readable stacked cards
- each card shows reviewer, pet breed, average score, date, temperament tags, handling score, environment score, and comment

### 8.4 Business Dashboard
Implemented in [page.tsx](file:///workspace/src/app/business/dashboard/page.tsx) and [reanalyze-button.tsx](file:///workspace/src/app/business/dashboard/reanalyze-button.tsx).

Features:
- shows claimed business summary
- shows subscription tier
- links to pricing flow
- links to public profile
- displays last AI tagging time
- includes manual website re-analysis action

### 8.5 Shared Frontend Concepts
- warm neutral visual language
- rounded cards and pills
- mobile-first layout approach
- clear badges for verified/premium/featured states

## 9. Backend Implementation
### 9.1 Search API
Implemented in [route.ts](file:///workspace/src/app/api/providers/search/route.ts).

Responsibilities:
- validate postcode
- build search cache key
- return cached results when available
- geocode postcode with Postcodes.io
- search Google Places using mapped keywords
- calculate provider distance from searched postcode
- merge live Google results with Supabase provider and review data
- expose structured rating fields
- filter results using stored AI tags where available
- sort nearest-first
- enrich only the first result with live Google details and AI summary

Key helper functions:
- `getPostcodeCoords()`
- `getDistanceMiles()`
- `getPlaceDetails()`
- `summarizeReviewsWithDeepSeek()`

### 9.2 Provider Live Details API
Implemented in [route.ts](file:///workspace/src/app/api/providers/[id]/live-details/route.ts).

Responsibilities:
- fetch live Google details for a provider
- optionally include AI review summary based on Google reviews
- return live `opening_hours`, website, phone, photos, reviews, and rating

Key helper function:
- `summarizeReviewsWithDeepSeek()`

### 9.3 Provider Ensure-Tags API
Implemented in [route.ts](file:///workspace/src/app/api/providers/[id]/ensure-tags/route.ts).

Responsibilities:
- check whether breed tags already exist in `pf_providers`
- upsert a provider row if needed
- avoid DeepSeek when saved breed tags already exist
- run website analysis only when tags are missing
- save `animals_served`, `services`, `breeds_specialised`, and `ai_tagged_at`
- return the saved provider row to the profile page

Behavioral significance:
- this route makes breed tagging behave similarly to cached AI summary generation
- first request may generate tags
- later requests reuse saved tags

### 9.4 Business Claim API
Implemented in [route.ts](file:///workspace/src/app/api/business/claim/route.ts).

Responsibilities:
- authenticate user
- create or update project provider row
- associate provider with `pf_profiles.owned_provider_id`
- run website analysis during claim when a website exists
- save AI-generated categorisation into the provider row

### 9.5 Business Reanalyze API
Implemented in [route.ts](file:///workspace/src/app/api/business/reanalyze/route.ts).

Responsibilities:
- authenticate business owner
- load the owner’s provider
- re-run website analysis
- update saved tags and `ai_tagged_at`

### 9.6 Reviews API
Implemented in [route.ts](file:///workspace/src/app/api/reviews/route.ts).

Responsibilities:
- accept native review submissions
- persist breed, temperament, handling, environment, and comment data
- trigger AI summary refresh for the provider

### 9.7 Review AI Summary API
Implemented in [route.ts](file:///workspace/src/app/api/reviews/[providerId]/ai-summary/route.ts).

Responsibilities:
- collect all native reviews for a provider
- require at least 5 reviews before summary generation
- prompt DeepSeek for a concise summary
- persist the summary on the provider row

### 9.8 Postcode Seed API
Implemented in [route.ts](file:///workspace/src/app/api/seed/postcode/route.ts).

Responsibilities:
- geocode postcode
- search Google Places per category
- optionally gather website text
- run AI categorisation for seeded providers
- store project-specific provider rows

### 9.9 Stripe Checkout API
Implemented in [route.ts](file:///workspace/src/app/api/stripe/checkout/route.ts).

Responsibilities:
- locate owner’s provider from profile
- create a Stripe checkout session
- attach provider reference metadata

## 10. Data Model
The project uses dedicated `pf_` tables so it does not interfere with pre-existing Supabase tables.

### 10.1 Core Tables
Defined in [schema.sql](file:///workspace/schema.sql).

- `pf_providers`
- `pf_provider_coords`
- `pf_reviews`
- `pf_profiles`
- `pf_subscriptions`
- storage bucket `pf-provider-photos`

### 10.2 Cache Table
Defined in [cache_schema.sql](file:///workspace/cache_schema.sql).

- `pf_search_cache`

### 10.3 Important Stored Fields
#### `pf_providers`
- business identity and contact fields
- `google_place_id`
- `animals_served`
- `services`
- `breeds_specialised`
- `subscription_tier`
- `ai_tagged_at`
- `review_summary`
- `review_summary_updated_at`

#### `pf_reviews`
- `dog_breed`
- `temperament_tags`
- `handling_rating`
- `environment_rating`
- `comment`

#### `pf_profiles`
- `is_business_owner`
- `owned_provider_id`

## 11. Authentication and Authorization
### 11.1 Auth Model
- Supabase Auth manages user identity.
- `pf_profiles` extends auth users.
- business ownership is represented through `owned_provider_id`.

### 11.2 RLS Model
Implemented in [schema.sql](file:///workspace/schema.sql).

Rules include:
- public read on providers and reviews
- authenticated review insertion
- users can edit/delete their own reviews
- business owners can update their own provider
- owners can view their own subscriptions

### 11.3 Middleware
Implemented in [middleware.ts](file:///workspace/src/middleware.ts).

Responsibilities:
- initialize Supabase SSR auth context
- refresh auth cookie state
- log request/auth debugging information

Note:
- Next.js 16 warns that `middleware.ts` should eventually become `proxy.ts`

## 12. External Integrations
### 12.1 Postcodes.io
Purpose:
- free postcode-to-coordinate conversion

Used in:
- search flow
- seed flow

### 12.2 Google Places
Purpose:
- nearby provider discovery
- live business metadata
- live photos and reviews
- opening hours

Used in:
- `/api/providers/search`
- `/api/providers/[id]/live-details`
- `/api/seed/postcode`

### 12.3 DeepSeek
Purpose:
- website categorisation into animals, services, and breeds
- review summary generation
- featured result summary generation from Google review snippets

Used in:
- `/api/business/claim`
- `/api/business/reanalyze`
- `/api/providers/[id]/ensure-tags`
- `/api/reviews/[providerId]/ai-summary`
- `/api/providers/search`
- `/api/providers/[id]/live-details`

### 12.4 Stripe
Purpose:
- paid subscription upgrade path for businesses

Used in:
- `/api/stripe/checkout`

## 13. Shared Utility Modules
### 13.1 Breed Taxonomy
Implemented in [breed-taxonomy.ts](file:///workspace/src/lib/breed-taxonomy.ts).

Responsibilities:
- define supported breed options
- map each breed to an animal group
- normalize AI output to valid breed values

Exports:
- `BREED_OPTIONS`
- `BREED_VALUES`
- `BREED_VALUES_BY_ANIMAL`
- `normalizeBreedValues()`

### 13.2 Provider AI Tagging
Implemented in [provider-ai-tagging.ts](file:///workspace/src/lib/provider-ai-tagging.ts).

Responsibilities:
- normalize website URLs
- fetch website HTML
- strip HTML into text context
- discover relevant same-origin pages
- collect multi-page context
- call DeepSeek with a structured taxonomy prompt
- normalize returned animals, services, and breeds

Exports:
- `AiTags`
- `tagProviderWebsite()`

Internal methods:
- `normalizeWebsiteUrl()`
- `stripHtmlToText()`
- `normalizeServiceValues()`
- `normalizeAnimalValues()`
- `extractRelevantLinks()`
- `fetchPageText()`
- `collectWebsiteContext()`
- `analyzeWithDeepSeek()`

## 14. Core Algorithms and Methods
### 14.1 UK Postcode Validation
Method:
- regex validation for full UK postcode format

Purpose:
- reject incomplete outcodes
- prevent malformed search requests
- reduce preview and routing issues

### 14.2 Postcode Normalization
Method:
- trim input
- uppercase
- remove spaces before building URL or cache key

Purpose:
- normalize queries
- stabilize routing
- improve cache reuse

### 14.3 Haversine Distance Calculation
Implemented in `getDistanceMiles()` in [search route](file:///workspace/src/app/api/providers/search/route.ts).

Method:
- convert lat/lng deltas to radians
- use Haversine formula
- convert earth arc distance into miles

Purpose:
- compute user-to-provider distance
- support nearest-first sorting
- display distance in result cards

### 14.4 Search Result Caching
Method:
- build cache key from normalized postcode, category, and radius
- check `pf_search_cache`
- return cached JSON when valid
- upsert fresh results on miss

Purpose:
- reduce Google API cost
- improve repeat search performance

### 14.5 Result Enrichment
Method:
- fetch Google results
- fetch matching Supabase providers by `google_place_id`
- fetch provider review rows
- merge business subscription and AI tags
- calculate native ratings

Purpose:
- combine live discovery with project-owned data

### 14.6 Native Rating Calculation
Method:
- for each review, average `handling_rating` and `environment_rating`
- average across all provider reviews
- round to one decimal place

Purpose:
- surface platform-native quality signal separately from Google rating

### 14.7 Featured Result Optimization
Method:
- sort nearest-first
- enrich only the first result with Google details and AI summary

Purpose:
- reduce API spend
- still provide a premium preview experience for the closest result

### 14.8 Breed Tag Generation Strategy
Method:
- use saved tags if present
- otherwise fetch website pages
- strip HTML to text
- prompt DeepSeek with strict supported breed taxonomy
- save generated tags into `pf_providers`

Purpose:
- avoid repeated AI calls
- ensure profile pages use saved database tags

### 14.9 Review Summary Generation Strategy
Method:
- wait until a provider has at least 5 native reviews
- submit structured review payload to DeepSeek
- save summary to provider row

Purpose:
- keep AI summaries stable and cheap
- avoid regenerating on every page view

## 15. Key Product Features Built So Far
### 15.1 Search and Discovery
- full postcode input enforcement
- nearby provider search
- category filtering
- breed filtering
- distance display
- nearest result prioritization
- featured first result
- search cache

### 15.2 Profile Experience
- live photos for eligible profiles
- Google rating display
- AI temperament summary
- open/closed status
- service categories
- breed support section
- call popup with copy control
- website and booking links
- claim CTA

### 15.3 Native Reviews
- authenticated review submission
- breed-specific review fields
- temperament tags
- handling and environment ratings
- AI summary generation after review threshold
- redesigned readable review cards

### 15.4 Business Tools
- claim listing
- attach provider to owner profile
- AI website categorisation on claim
- manual re-analyse website action
- pricing/subscription entry point

### 15.5 Admin / Operational Features
- postcode seeding
- middleware logging
- search debugging logs
- build verification

## 16. End-to-End Functional Flows
### 16.1 User Search Flow
1. User enters a full postcode on the home page.
2. Frontend validates and normalizes the postcode.
3. Search page requests `/api/providers/search`.
4. API checks cache.
5. If cache misses, API geocodes postcode and queries Google Places.
6. API merges any matching Supabase provider and review data.
7. API filters and sorts results.
8. API enriches the nearest result only.
9. Frontend renders results with tags, ratings, distance, and featured state.

### 16.2 Provider Profile Flow
1. User opens a provider profile.
2. Profile fetches live provider details from Google.
3. Profile checks `pf_providers` for a saved provider row.
4. If breed tags exist, it uses them immediately.
5. If breed tags are missing and website exists, it calls `ensure-tags`.
6. `ensure-tags` saves AI-generated tags into the database.
7. Profile fetch completes and renders saved breed categories plus reviews.

### 16.3 Review Submission Flow
1. Authenticated user opens review form.
2. User submits breed, ratings, temperament tags, and comment.
3. `/api/reviews` writes the review.
4. Review AI summary refresh is triggered.
5. If enough reviews exist, DeepSeek summary is regenerated and saved.

### 16.4 Business Claim Flow
1. Logged-in user claims a provider.
2. `/api/business/claim` creates or updates the provider row.
3. `pf_profiles.owned_provider_id` is updated.
4. If website exists, AI website analysis runs.
5. Saved tags become available on the profile page and dashboard.

## 17. Compliance and Cost-Control Strategy
### 17.1 Google Data Handling
- Google photos and reviews are not stored as permanent business content records.
- Search caches retain enriched response objects for performance, but photo usage still depends on ephemeral `photo_reference`.
- live details are fetched on-demand from Google APIs
- photo URLs are constructed at render time from fresh `photo_reference` values

### 17.2 Cost Controls
- search result cache reduces repeated Nearby Search calls
- first-result-only enrichment reduces expensive live detail usage
- review summary generation is threshold-based and cached in the database
- breed tagging is saved once and reused

## 18. Observability and Debugging
### 18.1 Logging
Current logging exists in:
- search page fetch lifecycle
- middleware auth/session handling
- provider AI tagging fetch failures
- ensure-tags failure path

### 18.2 Common Debug Targets
- malformed postcode input
- missing preview session token in Trae
- missing or expired Google photo references
- missing Supabase session during anonymous browsing
- DeepSeek failure or empty website extraction

## 19. Current Strengths
- practical legal/cost-aware architecture
- strong distinction between live Google data and platform-native data
- search cache in place
- breed taxonomy centralized
- AI tagging is saved and reusable
- build currently passes in production mode
- UI now covers major user flows end to end

## 20. Current Limitations and Outstanding Items
- photos upload flow is not finished
- verification flow is placeholder only
- subscription lifecycle beyond checkout is incomplete
- some admin tooling remains basic
- middleware file still needs renaming to `proxy.ts` for Next.js 16 convention
- first-time website tagging latency depends on website responsiveness and DeepSeek latency
- some legal/compliance nuances around cached Google-derived response shapes should be reviewed before public launch

## 21. Suggested Next Milestones
### 21.1 Product
- complete business verification flow
- finish subscription lifecycle and webhook updates
- add user profile/history features
- improve search empty states and sorting options

### 21.2 Technical
- rename `middleware.ts` to `proxy.ts`
- add stronger typed data models instead of pervasive `any`
- add focused integration tests for search, claim, and profile flows
- add explicit rate limits for AI-heavy routes
- add retry or queue strategy for website tagging if needed

### 21.3 Operational
- deploy to public Vercel environment
- configure production environment variables
- connect GitHub repo and CI flow
- schedule cache cleanup with cron

## 22. File Reference Index
### Frontend
- [home page](file:///workspace/src/app/page.tsx)
- [search page](file:///workspace/src/app/search/page.tsx)
- [provider profile](file:///workspace/src/app/provider/[id]/page.tsx)
- [business dashboard](file:///workspace/src/app/business/dashboard/page.tsx)
- [reanalyse button](file:///workspace/src/app/business/dashboard/reanalyze-button.tsx)

### Backend
- [search route](file:///workspace/src/app/api/providers/search/route.ts)
- [live details route](file:///workspace/src/app/api/providers/[id]/live-details/route.ts)
- [ensure tags route](file:///workspace/src/app/api/providers/[id]/ensure-tags/route.ts)
- [business claim route](file:///workspace/src/app/api/business/claim/route.ts)
- [business reanalyse route](file:///workspace/src/app/api/business/reanalyze/route.ts)
- [reviews route](file:///workspace/src/app/api/reviews/route.ts)
- [review AI summary route](file:///workspace/src/app/api/reviews/[providerId]/ai-summary/route.ts)
- [seed route](file:///workspace/src/app/api/seed/postcode/route.ts)
- [stripe checkout route](file:///workspace/src/app/api/stripe/checkout/route.ts)

### Shared Libraries and Schema
- [breed taxonomy](file:///workspace/src/lib/breed-taxonomy.ts)
- [provider AI tagging](file:///workspace/src/lib/provider-ai-tagging.ts)
- [middleware](file:///workspace/src/middleware.ts)
- [database schema](file:///workspace/schema.sql)
- [cache schema](file:///workspace/cache_schema.sql)

## 23. Conclusion
The current PawFinder build is no longer a rough scaffold. It now contains a coherent end-to-end product architecture with a working search experience, provider profiles, business claiming, AI-assisted categorisation, native reviews, summary generation, and cost-aware live enrichment.

The strongest architectural choice in the current system is the split between:
- live third-party discovery data
- saved platform-owned differentiator data

That separation supports both compliance and product identity, while keeping the application practical to extend into a production-ready public launch.
