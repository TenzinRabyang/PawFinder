## 1. Architecture Design
```mermaid
graph TD
    subgraph "Frontend (Next.js App Router)"
        A[Pages: Home, Search, Profile, Dashboard, Admin]
        B[Tailwind CSS & UI Components]
    end
    subgraph "Backend (Next.js API Routes)"
        C[Search API]
        D[Reviews API]
        E[Seeding API]
        F[Live Details API]
    end
    subgraph "Data Layer (Supabase)"
        G[(PostgreSQL DB)]
        H[Supabase Auth]
        I[Supabase Storage]
    end
    subgraph "External Services"
        J[Postcodes.io]
        K[Google Places API]
        L[DeepSeek API]
        M[Stripe API]
    end

    A <--> C
    A <--> D
    A <--> F
    A <--> E
    
    C <--> G
    D <--> G
    E --> J
    E --> K
    E --> L
    E --> G
    F --> K
    A <--> H
    A <--> I
    A <--> M
```

## 2. Technology Description
- **Frontend/Backend**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS
- **Database/Auth/Storage**: Supabase
- **Payments**: Stripe Checkout
- **External APIs**: Google Places, DeepSeek, Postcodes.io

## 3. Route Definitions
| Route | Purpose |
|-------|---------|
| `/` | Home page |
| `/search` | Search results page |
| `/provider/[id]` | Provider profile page |
| `/business/dashboard` | Business owner portal |
| `/business/subscribe` | Stripe pricing/checkout page |
| `/admin/seed` | Internal data seeding tool |

## 4. API Definitions
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/seed/postcode` | POST | Admin: trigger Postcodes.io, Google Places, DeepSeek ingestion |
| `/api/providers/search` | GET | Search providers using pure Supabase queries |
| `/api/providers/[id]/live-details` | GET | Fetch live Google Places data (Photos/Reviews) for Premium tiers |
| `/api/reviews` | POST | Submit native review |
| `/api/reviews/[providerId]/ai-summary` | POST | Generate AI summary via DeepSeek if >= 5 reviews |

## 5. Data Model

### 5.1 Data Model Definition
```mermaid
erDiagram
    providers ||--o{ provider_coords : "has"
    providers ||--o{ reviews : "receives"
    providers ||--o{ subscriptions : "has"
    profiles ||--o| providers : "owns"
    profiles ||--o{ reviews : "writes"

    providers {
        uuid id PK
        text name
        text category
        text address
        text postcode
        text phone
        text website
        text booking_url
        text google_place_id UK
        text[] animals_served
        text[] services
        text[] breeds_specialised
        boolean is_verified
        text subscription_tier
        timestamptz ai_tagged_at
        text review_summary
        timestamptz review_summary_updated_at
        timestamptz created_at
    }
    
    provider_coords {
        uuid provider_id FK
        numeric lat
        numeric lng
    }

    reviews {
        uuid id PK
        uuid provider_id FK
        uuid user_id FK
        text dog_breed
        text[] temperament_tags
        int handling_rating
        int environment_rating
        text comment
        timestamptz created_at
    }

    profiles {
        uuid id PK "references auth.users(id)"
        text full_name
        boolean is_business_owner
        uuid owned_provider_id FK
    }

    subscriptions {
        uuid id PK
        uuid provider_id FK
        text stripe_customer_id
        text status
        timestamptz current_period_end
    }
```
