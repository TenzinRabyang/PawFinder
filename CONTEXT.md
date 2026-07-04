### 1. Project Overview

PawFinder is a UK-focused pet services directory built for pet owners searching for trusted nearby providers such as vets, groomers, walkers, sitters, trainers, kennels, and pet shops. The app combines Google Places data, Supabase-backed profile data, native temperament reviews, and AI-assisted provider analysis to make provider discovery more useful than a generic map search. It also includes business-owner tools for claiming listings, managing subscriptions, and refreshing AI-generated profile data.

### 2. Tech Stack

- **Frontend:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, `next/font` (Geist + Quicksand), `lucide-react`
- **Backend/Database:** Next.js Route Handlers, Supabase Postgres, Supabase Auth, Supabase Storage integration points, Supabase SSR/client/admin helpers, middleware-based auth session refresh
- **Key Dependencies:** `@supabase/ssr`, `@supabase/supabase-js`, `stripe`, `pg`, `clsx`, `tailwind-merge`, `date-fns`, `lucide-react`, `typescript`
- **External APIs/Services:** Google Places API, Google Place Photos, Postcodes.io, DeepSeek API, OpenAI API, Stripe, Vercel deployment target

### 3. Core Features (Implemented So Far)

- **Homepage search entry:** Supports full UK postcode search with validation and town/city autocomplete, then redirects users into the search flow using either postcode or resolved coordinates.
- **Quick animal discovery:** Homepage includes direct entry points for Dog, Cat, Rabbit, and Small Pet browsing.
- **Search results page:** Loads providers by postcode or latitude/longitude, applies filters for category, animal, service, and breed, and supports sorting by distance, rating, and review count.
- **Progressive result loading:** Search results initially show a limited set and expand with a "load more" style interaction.
- **Featured result enrichment:** Highlighted results receive delayed enrichment for stronger photos, ratings, and AI-generated review content without blocking the initial result list.
- **Provider search enrichment:** Search APIs merge live Google Places search results with saved Supabase provider records, subscription state, verification state, saved tags, inferred services, and native review aggregates.
- **Postcode search caching:** Postcode-based provider searches are cached in Supabase-backed cache tables, with an admin-only force refresh path.
- **Coordinate-based search:** Users who select a specific autocomplete location can search directly from lat/lng instead of a postcode.
- **Breed-aware filtering:** Search logic supports exact breed specialisms plus broader inferred animal coverage.
- **Provider profile pages:** Each provider page combines saved provider data with live Google data such as ratings, reviews, phone, address, photos, and open/closed state.
- **Photo handling:** Provider photos are served through an internal Google photo proxy route and rendered through a reusable image component with placeholder fallback behavior.
- **Public trust signals:** Profiles display subscription tier, verification state, review data, and AI analysis status to communicate listing quality and completeness.
- **Native review submission:** Signed-in users can submit provider reviews with breed, temperament tags, handling rating, environment rating, and written comments.
- **Native review rendering:** Provider profiles calculate and display aggregate native ratings and individual review cards.
- **AI review summaries:** The app can generate AI summaries from provider review content when enough review data exists.
- **AI website analysis:** Providers can be analyzed from website content to infer category, services, supported animals, breed specialization, and booking-related data.
- **AI photo fallback analysis:** If a provider has no usable website, the app can fall back to analyzing available Google photos to infer broad animal coverage.
- **Analysis state tracking:** Provider pages and dashboard views expose clear analysis states such as completed, delayed, retrying, fetch blocked, no website, and exhausted.
- **Authentication:** Supports email/password sign-in, email/password sign-up, Google OAuth sign-in, Supabase auth callback handling, and sign-out.
- **Session-aware navigation:** Navbar changes based on whether the user is authenticated and links business owners to the dashboard.
- **Business claim flow:** Business owners can claim an existing provider listing, attach it to their profile, and trigger initial AI analysis during the claim workflow.
- **Business dashboard:** Claimed businesses can view provider data, subscription tier, analysis freshness, saved animal/service/breed data, and link to the public profile.
- **Manual re-analysis:** Business owners can rerun AI analysis from the dashboard to refresh saved provider metadata.
- **Subscription plans UI:** Business owners can view Free, Verified, and Premium tiers from a dedicated subscription page.
- **Stripe checkout:** Paid plans are initiated through a Stripe checkout route.
- **Stripe webhook sync:** Stripe webhooks update provider subscription records, tier state, and verification state.
- **Admin postcode seeding:** Internal admin tooling can seed providers by postcode using external APIs and store enriched provider records in the database.
- **Operational scripts and SQL:** The repo includes checked-in SQL schema files and root maintenance/debug scripts for database setup, caching, and region/connectivity checks.

### 4. File Architecture

```text
.
├─ src/
│  ├─ app/                              # Next.js App Router pages and route handlers
│  │  ├─ page.tsx                       # Homepage: hero, postcode/place search, quick animal links
│  │  ├─ layout.tsx                     # Root layout, fonts, global shell
│  │  ├─ globals.css                    # Tailwind import, theme tokens, shared animations/utilities
│  │  ├─ search/
│  │  │  └─ page.tsx                    # Search UI, filters, sorting, featured result enrichment
│  │  ├─ provider/
│  │  │  └─ [id]/
│  │  │     └─ page.tsx                 # Provider profile page, reviews, AI analysis UX
│  │  ├─ login/
│  │  │  └─ page.tsx                    # Auth entry page
│  │  ├─ auth/
│  │  │  ├─ callback/
│  │  │  │  └─ route.ts                 # Supabase OAuth/email callback exchange
│  │  │  └─ signout/
│  │  │     └─ route.ts                 # Sign-out route
│  │  ├─ business/
│  │  │  ├─ dashboard/
│  │  │  │  ├─ page.tsx                 # Business dashboard server page
│  │  │  │  ├─ claim-listing-card.tsx   # Claim listing client workflow
│  │  │  │  └─ reanalyze-button.tsx     # Manual AI reanalysis trigger
│  │  │  └─ subscribe/
│  │  │     └─ page.tsx                 # Plan/pricing page
│  │  ├─ admin/
│  │  │  └─ seed/
│  │  │     └─ page.tsx                 # Internal postcode seeding UI
│  │  └─ api/                           # Backend route handlers
│  │     ├─ location-autocomplete/      # Place autocomplete using Google Places
│  │     ├─ location-details/           # Resolve place_id to lat/lng
│  │     ├─ google-photo/               # Google Place photo proxy
│  │     ├─ providers/
│  │     │  ├─ search/                  # Postcode-based provider search + cache
│  │     │  ├─ search-by-location/      # Lat/lng-based provider search
│  │     │  └─ [id]/
│  │     │     ├─ live-details/         # Live provider details and review enrichment
│  │     │     ├─ featured-enrichment/  # Featured-card enrichment
│  │     │     └─ ensure-tags/          # AI analysis persistence/orchestration
│  │     ├─ reviews/
│  │     │  ├─ route.ts                 # Native review submission
│  │     │  └─ [providerId]/
│  │     │     └─ ai-summary/           # AI summary generation for reviews
│  │     ├─ business/
│  │     │  ├─ claim/                   # Claim existing listing
│  │     │  └─ reanalyze/               # Rerun provider analysis
│  │     ├─ stripe/
│  │     │  ├─ checkout/                # Create Stripe checkout session
│  │     │  └─ webhook/                 # Stripe webhook processing
│  │     └─ seed/
│  │        └─ postcode/                # Admin seeding/import by postcode
│  ├─ components/                       # Shared reusable UI
│  │  ├─ Navbar.tsx                     # Session-aware top navigation
│  │  ├─ LoginForm.tsx                  # Email/password + Google auth form
│  │  └─ ProviderImage.tsx              # Provider image wrapper with fallback logic
│  ├─ lib/                              # Domain/business logic helpers
│  │  ├─ breed-taxonomy.ts              # Breed option taxonomy and mappings
│  │  ├─ provider-category.ts           # Provider category resolution logic
│  │  ├─ provider-name-service-inference.ts
│  │  │                                  # Infer services from provider/category naming
│  │  ├─ provider-analysis-state.ts     # Breed/analysis state helpers and retry rules
│  │  ├─ website-analysis-status.ts     # Dashboard-oriented analysis status helpers
│  │  ├─ provider-ai-tagging.ts         # AI tagging/orchestration logic
│  │  ├─ persist-provider-ai-tags.ts    # Persist AI tags to Supabase
│  │  ├─ provider-photo-inference.ts    # Photo-based inference logic
│  │  └─ provider-place-id-recovery.ts  # Recovery/lookup utilities for place IDs
│  ├─ utils/
│  │  └─ supabase/
│  │     ├─ client.ts                   # Browser Supabase client
│  │     ├─ server.ts                   # SSR/request Supabase client
│  │     └─ admin.ts                    # Privileged service-role Supabase client
│  └─ middleware.ts                     # Auth/session refresh middleware
├─ public/                              # Static assets and SVGs
├─ docs/                                # Investigation notes and build reports
├─ .trae/documents/                     # Product/architecture docs used during development
├─ schema.sql                           # Main Supabase schema
├─ cache_schema.sql                     # Search cache schema
├─ performance_optimizations.sql        # DB indexes/cache optimizations
├─ setup-db.js                          # DB setup script using pg
├─ find-region.js                       # Operational/debug utility
├─ find-region2.js                      # Operational/debug utility
├─ test-eu-west-2.js                    # Connectivity/debug script
├─ package.json                         # App scripts and dependencies
├─ next.config.ts                       # Next.js config and remote image rules
├─ tsconfig.json                        # TypeScript config and @/* path alias
├─ postcss.config.mjs                   # PostCSS/Tailwind wiring
├─ eslint.config.mjs                    # ESLint config
├─ README.md                            # Minimal project overview
├─ AGENTS.md                            # Workspace rules for AI agents
└─ CLAUDE.md                            # Project notes for AI tooling
```

### 5. Architectural Rules & Conventions

- **Treat this as a single full-stack Next.js app.** Frontend pages, backend APIs, and business logic all live in one repository under `src/`.
- **Use App Router conventions.** Pages and route handlers live in `src/app`; prefer server components by default and add `'use client'` only when a file needs hooks, browser APIs, or client-side event handlers.
- **Read the local Next.js docs before framework-level changes.** This workspace explicitly warns that the installed Next.js version has breaking changes compared with older conventions; check the relevant guides under `node_modules/next/dist/docs/` before changing framework behavior.
- **Keep route-specific components colocated.** If a component is only used by one route, keep it inside that route folder. Put cross-route reusable UI in `src/components`.
- **Keep shared domain logic in `src/lib`.** Anything involving provider classification, breed rules, AI analysis, status computation, or reusable transformations belongs there instead of inside pages when it is reusable across routes.
- **Use Supabase through the existing wrappers.** Browser code uses `src/utils/supabase/client.ts`, server/request code uses `src/utils/supabase/server.ts`, and privileged workflows use `src/utils/supabase/admin.ts`.
- **Keep auth/session handling centralized.** Do not invent a parallel auth flow; rely on Supabase Auth plus `src/middleware.ts` for request/session refresh.
- **Use route handlers as workflow orchestrators.** API routes usually validate input, check auth, fetch external data, merge with Supabase records, persist updates, and then return normalized JSON.
- **Preserve the `pf_` data model naming.** Database tables, profile shapes, and several in-code variables mirror the Supabase schema directly (`pf_providers`, `pf_reviews`, `pf_profiles`, etc.); do not arbitrarily rename domain concepts away from the database vocabulary.
- **Prefer normalized snake_case domain values.** Many persisted enum/array values are stored as snake_case strings and formatted into display labels at the UI boundary.
- **Use explicit status-driven state.** The codebase favors descriptive string-union style statuses such as `loading`, `ready`, `delayed`, `retrying`, `fetch_blocked`, and `photo_exhausted` instead of opaque booleans.
- **Favor local React state over global stores.** State is managed with `useState`, `useEffect`, `useMemo`, `useRef`, and client fetches; `zustand` is installed but not actively used in the current app.
- **Use TypeScript strictly and import via `@/`.** The project uses the `@/*` alias for imports from `src`, and most files are typed enough to make data shapes and statuses explicit.
- **Match local file style instead of mass reformatting.** Most application code uses single quotes and minimal semicolons, but some scaffold/config files still use double quotes and semicolons. Follow the surrounding file's style rather than rewriting unrelated formatting.
- **Style almost everything with Tailwind utility classes.** The visual system is primarily inline Tailwind in JSX; reserve `globals.css` for theme tokens, lightweight shared utilities, and small animation helpers.
- **Preserve the current visual language.** UI uses warm neutrals (`stone` palette), soft shadows, rounded cards, pill badges, and brand accents around muted green and orange. New UI should feel consistent with that design system.
- **Prefer graceful fallbacks.** Existing code handles delayed AI analysis, missing photos, blocked website fetches, incomplete provider data, and partial enrichment states explicitly; new work should preserve that progressive enhancement style.
- **Keep business logic pragmatic.** Page-local helper functions are acceptable when the logic is only used in one screen, but reusable provider/search/analysis rules should be extracted into `src/lib`.
- **Respect current monetization boundaries.** Subscription tier, verification state, and "featured" behavior control what data and presentation a provider receives; avoid introducing UI or API behavior that bypasses those checks.
- **Treat admin and ops files as part of the product context.** The SQL files and root scripts are not dead code; they document schema assumptions, cache behavior, and operational setup that other AIs should understand before making backend changes.
