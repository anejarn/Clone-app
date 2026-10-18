# Architecture: vacation-rental clone (airbnb.fr replica)

Built from the recon in [`recon/airbnb-fr.md`](./recon/airbnb-fr.md) and [`recon/design-tokens.json`](./recon/design-tokens.json).
Product name: **Sigma** since 14 October 2026; this plan was written under the working name Nidou (own brand, own logo, free font: no Airbnb assets).

> **Changes since this plan was written** (see the README and [`api.md`](./api.md) for what is built):
> - Next.js **16** with Cache Components instead of 15; data reads use `"use cache"` + `cacheTag` rather than `revalidate`.
> - **Postgres everywhere** (no SQLite for local dev): Prisma 7 with the `prisma-client` generator and the `pg` driver adapter; `docker-compose.yml` starts a local database.
> - **Better Auth** instead of Auth.js v5, which is still in beta; email + password only so far.
> - Schema differences from §5: `PropertyType` uses enum keys (`APARTMENT`, …) with French labels in `lib/labels.ts`; there is no "Particulier/Professionnel" label any more (`User.isProfessional` was removed in Lot 1: Sigma manages every listing); `hostId` became `ownerId`, the propriétaire (role OWNER, same organization: composite foreign key `(ownerId, organizationId)` and the `listings_owner_role_check` trigger), never exposed by the public API; listings also carry `managementType` (MANAGED = mandat de gestion, SUBLEASE = sous-location), `commissionBps` (0–10000, default from `Organization.defaultCommissionBps`), an internal `address`, the loi 80-14 `licenseNumber` / `licenseExpiresAt`, and `minNights` (≥ 1, enforced by `quoteStay`); `PropertyType` gained `RIAD`; bookings have a `source` (DIRECT, AIRBNB, BOOKING, AGODA, TRIPCOM, EXPEDIA, OWNER = owner block), a platform `externalRef` (unique per organization and source), an optional `guestId` plus internal `guestName`/`guestEmail`/`guestPhone`, and a price snapshot (nightly, cleaning, service fee, total) that is NULL for owner blocks and for platform bookings whose amount isn't known yet (checks by source in migration `20261019090000_booking_sources`); reviews, wishlists and wishlist items carry `organizationId`, held to their listing's organization by composite foreign keys; `Place.searchName` powers accent-insensitive autosuggest; overlapping confirmed stays are blocked by a Postgres exclusion constraint.
> - Autosuggest is fetched from `/api/autosuggest` instead of shipping every place to the client.
> - **Back-office `/admin`** (Lot 2): sections and their roles in `lib/admin/sections.ts`; access control in `lib/server/authz.ts` (`checkAccess` + `requireAdminPage` / `requireAdminAction` / `requireAdminApi`, and `requireRole*` for other role-restricted areas), which reads role, organization and 2FA status from the database on every call and returns the only `organizationId` the caller may use; `proxy.ts` redirects requests without a session cookie to `/login` (optimistic only). Pages read the session inside `<Suspense>` (Cache Components), so a refused page renders the not-found UI with status 200; APIs answer 401/403. Double authentification uses Better Auth's `twoFactor` plugin (TOTP + 10 backup codes, both encrypted with `BETTER_AUTH_SECRET`; table `two_factors`, `users.twoFactorEnabled`, migration `20261020090000_two_factor`); it is compulsory for ADMIN and AGENT, enrolled at `/admin/securite`, and asked for on the login page after the password.
> - **Biens** (Lot 2b): `/admin/biens` (list, `nouveau`, `[id]` fiche with photos, `[id]/modifier`), sub-pages guarded with their section's path; logic in `lib/server/admin/listings.ts`, form validation in `lib/admin/listing-form.ts`, 80-14 status in `lib/admin/license.ts` (alert 60 days ahead, today in Africa/Casablanca), dirham/percent conversions in `lib/money.ts`. Migration `20261021090000_listing_management`: `Listing.status` (DRAFT/PUBLISHED, public reads filter on PUBLISHED), `city`, `houseRules`, `updatedAt`, `Photo.storageKey`, and `listings_sublease_commission_check`. Uploads go through `lib/storage/` (local disk for now, served by `app/media/[...key]/route.ts`).
> - **Calendrier et réservations** (Lot 2d): `/admin/calendrier` (timeline from md up, agenda on phones, detail panel; `components/admin/bookings/CalendarBoard.tsx`), `/admin/reservations` (list, `[id]` page with change of dates and cancellation), `/admin/reservations/nouvelle` (ADMIN-only section: direct booking, platform booking, owner block). Logic in `lib/server/admin/bookings.ts`, form validation and amount computations in `lib/admin/booking-form.ts`, grid date math in `lib/admin/calendar.ts` (UTC-midnight days, today in Africa/Casablanca), source labels and colours in `lib/admin/booking-sources.ts`. Migration `20261023090000_booking_entry`: `Booking.channel` (enum `BookingChannel`, DIRECT only: `bookings_channel_check`) and `Booking.note` (≤ 2 000 characters).

---

## 1. Goals & scope

| Phase | Scope | Done when |
|---|---|---|
| **P0 – Foundation** | Repo, tooling, design tokens, UI primitives, layout shell (header, footer, mobile bottom nav) | Storybook-free primitives render in both breakpoints; CI green |
| **P1 – Homepage** | Category tabs, big search bar (destination / dates / guests popovers), carousel sections, SEO link grid, cookie modal | Visual parity with recon screenshots at 390 / 1440px |
| **P2 – Search** | `/s/[place]/homes`: results grid, filters modal, map with price pins, pagination | Searching from homepage yields filtered results + map |
| **P3 – Listing** | `/rooms/[id]`: photo mosaic + gallery, details, amenities, reviews, booking card with price breakdown | Can pick dates/guests and see a correct total |
| **P4 – Accounts** | Auth modal (email + OAuth), wishlists (Favoris), trips, booking creation | Logged-in user can save and book |
| **P5 – Hosting** (stretch) | Create/edit listing, calendar availability | – |

Out of scope: payments (mocked "Réserver" flow), messaging, real-time availability, Expériences/Services detail pages (tabs exist, show listing-like cards).

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript** | SSR/streaming like the original; Server Components keep listing pages fast |
| Styling | **Tailwind CSS v4** with tokens as CSS variables | Recon tokens map 1:1 to `@theme` vars; atomic CSS like Airbnb's Linaria output |
| UI primitives | **Radix UI** (Dialog, Popover, Tabs, DropdownMenu) | Accessible popovers/modals for search segments, menu, cookie dialog |
| Carousels | **Embla Carousel** | Snap scrolling with prev/next buttons, matches `content-scroller` |
| Date range | **react-day-picker v9** + `date-fns` (fr locale) | Two-month range calendar |
| Map | **MapLibre GL** + OpenStreetMap tiles (via `react-map-gl`) | Free; price-pin markers |
| Data | **PostgreSQL + Prisma** (SQLite for local dev) | Relational model fits listings/bookings/reviews |
| Server API | **Server Actions + Route Handlers** (`/api/*`), validated with **Zod** | No separate backend needed |
| Client state | URL search params (single source of truth for search) + **Zustand** for ephemeral UI (open popover, compact header) | Shareable URLs like `/s/Paris/homes?checkin=…` |
| Data fetching (client) | **TanStack Query** for autosuggest, map-bounds search, wishlist toggles | Caching/debouncing |
| Auth | **Auth.js (NextAuth v5)**: credentials + Google | P4 |
| Images | `next/image` + seed photos from Unsplash (license-safe), stored in `/public/seed` or S3-compatible bucket | No `muscache.com` hotlinking |
| i18n | **next-intl**, default `fr`, ready for `en` | Original is FR-first; currency formatting via `Intl.NumberFormat('fr-FR', {currency:'EUR'})` |
| Testing | **Vitest** + Testing Library (unit), **Playwright** (e2e + visual snapshots at 390/1440) | Chromium is preinstalled in the env |
| Quality | ESLint, Prettier, `tsc --noEmit`, GitHub Actions CI | |
| Package manager | **pnpm** | |

---

## 3. Repository layout

```
.
├── app/
│   ├── layout.tsx                 # <html lang="fr">, font, providers, CookieConsent
│   ├── (marketing)/
│   │   └── page.tsx               # Homepage (P1)
│   ├── s/[place]/homes/page.tsx   # Search results (P2)
│   ├── rooms/[id]/
│   │   ├── page.tsx               # Listing detail (P3)
│   │   └── photos/page.tsx        # Full gallery (intercepted modal route)
│   ├── wishlists/page.tsx         # Favoris (P4)
│   ├── trips/page.tsx             # Voyages (P4)
│   ├── help/… terms/…             # Static footer pages (MDX stubs)
│   └── api/
│       ├── autosuggest/route.ts   # GET ?q=   → places
│       ├── listings/route.ts      # GET search (bounds, dates, guests, filters)
│       ├── wishlists/route.ts     # POST/DELETE save toggle
│       └── auth/[...nextauth]/route.ts
├── components/
│   ├── ui/                        # Primitives: Button, IconButton, Pill, Chip, Avatar, Divider, Modal, Popover, Skeleton
│   ├── layout/                    # Header, CategoryTabs, UserMenu, Footer, MobileBottomNav, AppBanner
│   ├── search/                    # BigSearch, CompactSearch, DestinationField, DatesField, GuestsField, MobileSearchSheet
│   ├── listing/                   # ListingCard, ImageCarousel, SaveButton, Badge, PriceLine, Rating
│   ├── home/                      # CarouselSection, DestinationTile, ServiceTile, InspirationGrid
│   ├── results/                   # ResultsGrid, FiltersModal, ResultsMap, PricePin
│   └── room/                      # PhotoMosaic, HostSummary, Amenities, BookingCard, PriceBreakdown, Reviews
├── lib/
│   ├── db.ts                      # Prisma client singleton
│   ├── search/params.ts           # Zod schema ⇄ URLSearchParams (parse/serialize)
│   ├── search/query.ts            # Prisma query builder for listings search
│   ├── pricing.ts                 # nights × price + cleaning + service fee, pure + unit-tested
│   ├── format.ts                  # fr-FR currency/date/range ("8–10 janv.")
│   └── auth.ts
├── styles/
│   ├── tokens.css                 # Generated from docs/recon/design-tokens.json
│   └── globals.css
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                    # ~300 fake listings across ~20 cities (faker fr)
├── scripts/
│   └── build-tokens.ts            # design-tokens.json → styles/tokens.css + Tailwind @theme
├── messages/fr.json, en.json      # next-intl strings
├── tests/
│   ├── unit/…
│   └── e2e/ home.spec.ts, search.spec.ts, room.spec.ts (+ visual snapshots)
└── docs/ recon/, architecture.md
```

---

## 4. Design system

`scripts/build-tokens.ts` turns the recon JSON into CSS variables, exposed to Tailwind v4 via `@theme`:

```css
@theme {
  --color-brand: #FF385C;          /* rausch */
  --color-brand-strong: #DA1249;   /* search button */
  --color-ink: #222222;            /* hof */
  --color-ink-muted: #6A6A6A;      /* foggy */
  --color-line: #DDDDDD;           /* deco */
  --color-surface-2: #F7F7F7;      /* faint */
  --color-error: #C13515; --color-success: #008A05; --color-link: #0D4DAA;
  --font-sans: "Inter Variable", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px; --radius-pill: 32px;
  --shadow-e1: 0 0 0 1px rgb(0 0 0/.02), 0 2px 4px rgb(0 0 0/.16);
  --shadow-e3: 0 0 0 1px rgb(0 0 0/.02), 0 8px 24px rgb(0 0 0/.10);
  --shadow-popover: 0 6px 16px rgb(0 0 0/.12);
  --shadow-modal: 0 8px 28px rgb(0 0 0/.28);
  --ease-standard: cubic-bezier(.2,0,0,1); --ease-enter: cubic-bezier(.1,.9,.2,1);
  --breakpoint-md: 744px; --breakpoint-lg: 1128px; --breakpoint-xl: 1440px;
}
.bg-brand-gradient { background: linear-gradient(to right,#E61E4D,#E31C5F,#D70466); }
```

Type scale utilities: `text-12`, `text-13`, `text-14` (base, lh 20px), `text-16`, `text-18`, `text-22/26 semibold` (section titles), `text-26`, `text-32`.
Page gutter: `px-6 lg:px-10 xl:px-12` (24 → 40 → 48px); max content width 1760px.

Primitive contract (all in `components/ui`): forwardRef, `className` merge via `tailwind-merge`, variants via `cva`. Buttons: `primary` (brand gradient), `dark` (`#222`), `outline`, `ghost`, `icon-circle` (32/40/48px).

---

## 5. Data model (Prisma)

```prisma
model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  image     String?
  isHost    Boolean  @default(false)
  listings  Listing[] @relation("HostListings")
  bookings  Booking[]
  reviews   Review[]
  wishlists Wishlist[]
  createdAt DateTime @default(now())
}

model Place {                      // cities / regions for autosuggest & SEO grid
  id        String  @id @default(cuid())
  slug      String  @unique        // "paris", "ile-de-re"
  name      String
  country   String
  lat       Float
  lng       Float
  tagline   String?                // "Pour la tour Eiffel"
  imageUrl  String
  listings  Listing[]
}

enum Category   { HOME EXPERIENCE SERVICE }
enum PropertyType { APARTMENT HOUSE VILLA CHALET COTTAGE HOTEL CABIN OTHER }

model Listing {
  id            String   @id @default(cuid())
  category      Category @default(HOME)
  type          PropertyType
  title         String              // "Appartement · Paris" is derived, not stored
  description   String
  placeId       String
  place         Place    @relation(fields: [placeId], references: [id])
  hostId        String
  host          User     @relation("HostListings", fields: [hostId], references: [id])
  lat           Float
  lng           Float
  maxGuests     Int
  bedrooms      Int
  beds          Int
  bathrooms     Float
  pricePerNight Int                 // cents EUR
  cleaningFee   Int      @default(0)
  isGuestFavorite Boolean @default(false)   // "Coup de cœur voyageurs" badge
  isProfessionalHost Boolean @default(false) // "Particulier" vs "Professionnel"
  ratingAvg     Float?               // denormalised, updated on review insert
  reviewCount   Int      @default(0)
  photos        Photo[]
  amenities     ListingAmenity[]
  bookings      Booking[]
  reviews       Review[]
  wishlistItems WishlistItem[]
  createdAt     DateTime @default(now())
  @@index([placeId]) @@index([lat, lng]) @@index([category, type])
}

model Photo     { id String @id @default(cuid()); listingId String; listing Listing @relation(fields:[listingId], references:[id], onDelete: Cascade); url String; alt String; position Int; @@index([listingId, position]) }
model Amenity   { id String @id; label String; icon String; group String; listings ListingAmenity[] }
model ListingAmenity { listingId String; amenityId String; listing Listing @relation(fields:[listingId], references:[id], onDelete: Cascade); amenity Amenity @relation(fields:[amenityId], references:[id]); @@id([listingId, amenityId]) }

enum BookingStatus { PENDING CONFIRMED CANCELLED }
model Booking {
  id        String   @id @default(cuid())
  listingId String
  listing   Listing  @relation(fields: [listingId], references: [id])
  guestId   String
  guest     User     @relation(fields: [guestId], references: [id])
  checkIn   DateTime @db.Date
  checkOut  DateTime @db.Date
  adults    Int
  children  Int      @default(0)
  infants   Int      @default(0)
  pets      Int      @default(0)
  totalCents Int
  status    BookingStatus @default(CONFIRMED)
  createdAt DateTime @default(now())
  @@index([listingId, checkIn, checkOut])
}

model Review    { id String @id @default(cuid()); listingId String; listing Listing @relation(fields:[listingId], references:[id], onDelete: Cascade); authorId String; author User @relation(fields:[authorId], references:[id]); rating Int; body String; createdAt DateTime @default(now()) }
model Wishlist  { id String @id @default(cuid()); userId String; user User @relation(fields:[userId], references:[id]); name String; items WishlistItem[] }
model WishlistItem { wishlistId String; listingId String; wishlist Wishlist @relation(fields:[wishlistId], references:[id], onDelete: Cascade); listing Listing @relation(fields:[listingId], references:[id], onDelete: Cascade); @@id([wishlistId, listingId]) }
```

Availability = no overlapping `CONFIRMED` booking: `NOT EXISTS (b.checkIn < :checkout AND b.checkOut > :checkin)`.

> The block above is the replica's original sketch; the current model is `prisma/schema.prisma`. Prices (Lot 2e): `Listing.priceCents` is the base price; `PriceRule` (+ `PriceRuleListing`) holds the organization's seasons and events; the pure engine `lib/pricing/engine.ts` turns them into per-night prices and a stay's minimum, for the quote, bookings, search and the back-office.

---

## 6. Routes & data flow

### Search params (one Zod schema, shared by server + client)
```
/s/{place}/homes?checkin=2026-01-08&checkout=2026-01-10&adults=2&children=0&infants=0&pets=0
               &price_min=&price_max=&type=apartment,house&bedrooms=&amenities=wifi,pool
               &ne_lat=&ne_lng=&sw_lat=&sw_lng=&cursor=
```
`lib/search/params.ts` exports `parseSearchParams(URLSearchParams) → SearchQuery` and `toSearchParams(SearchQuery)`. The URL is the state; components read via `useSearchParams` and write via `router.push`.

### Pages
| Route | Rendering | Data |
|---|---|---|
| `/` | Server Component, `revalidate: 3600` | `getHomeSections()` → destinations, services, 4–6 listing carousels (by place, "ce week-end", hotels, experiences). Sections stream with `<Suspense>` + card skeletons |
| `/s/[place]/homes` | Server Component, dynamic | First page of results server-rendered; map-bounds moves refetch via TanStack Query → `GET /api/listings` |
| `/rooms/[id]` | Server Component, `revalidate: 600`; booking card is a Client Component | `getListing(id)` + bookings for calendar disabled dates; price via `lib/pricing.ts` |
| `/rooms/[id]/photos` | Intercepting route `(.)photos` → modal gallery | – |
| `/wishlists`, `/trips` | Server, auth-gated | user-scoped queries |

### API (Route Handlers)
| Endpoint | Purpose |
|---|---|
| `GET /api/autosuggest?q=` | Places by prefix (ILIKE / unaccent); returns `{slug,name,country}`; debounced 150ms client-side |
| `GET /api/listings?…` | Same schema as page; returns `{items, nextCursor, total}`, ≤ 24 per page |
| `POST /api/wishlists/toggle` | `{listingId}` → optimistic heart toggle; 401 opens auth modal |
| Server Action `createBooking` | Re-validates availability + price server-side in a transaction |

---

## 7. Key components

**Header** (`layout/Header.tsx`, client): two states driven by scroll (`IntersectionObserver` on a sentinel): *expanded* (96px + BigSearch) → *compact* (80px, `CompactSearch` pill "N'importe où · Une semaine · Ajouter des voyageurs"). Clicking compact re-expands with overlay. Under 744px: `MobileSearchPill` + `CategoryChips`; `MobileBottomNav` fixed bottom.

**BigSearch** (`search/BigSearch.tsx`): `<form role="search" data-testid="big-search">` with three Radix `Popover` segments; the active segment gets white bg + shadow while the bar turns `#EBEBEB`. Submitting serialises to `/s/{slug}/homes?...`. Mobile: full-screen `MobileSearchSheet` with stacked accordion steps.

**ListingCard** (`listing/ListingCard.tsx`, Server Component shell + client `ImageCarousel` & `SaveButton`): props `{id, photos, typeLabel, placeName, dateRange?, hostKind, priceTotalCents | pricePerNightCents, rating?, reviewCount, badge?}`. Keeps recon test IDs: `card-container`, `listing-image`, `listing-card-title`, `listing-card-save-button`.

**CarouselSection** (`home/CarouselSection.tsx`): title (22/26 semibold) + prev/next 32px circles (Embla API), `data-testid="content-scroller"`; responsive slide widths: 2.3 (mobile) → 4 → 6 → 7 per view.

**BookingCard** (`room/BookingCard.tsx`): sticky on lg; dates + guests pickers reuse search components; `PriceBreakdown` from `lib/pricing.ts`; gradient "Réserver" CTA → `createBooking`.

---

## 8. Cross-cutting concerns

- **Accessibility:** Radix gives focus traps/ARIA; carousels have labelled buttons; card link uses `aria-labelledby` on the title like the original; colour contrast checked (foggy `#6A6A6A` on white passes AA).
- **Performance budget:** LCP < 2.5s on homepage (first card image `priority`), JS < 200 KB gz on `/`. Images via `next/image` with `sizes` mirroring recon breakpoints (`(max-width:743px) 342px, (max-width:1127px) 216px, 250px`).
- **SEO:** `generateMetadata` per page, FR titles; inspiration grid gives internal links to `/s/{place}/homes`; sitemap from `Place` table.
- **Cookie consent:** first-visit Radix Dialog storing a `consent` cookie; analytics stubs only load after "Accepter tout".
- **Error/empty states:** route-level `error.tsx`/`not-found.tsx`; the "no carousels" fallback the recon observed (inspiration grid + footer only) is the homepage's degraded state when section queries fail.
- **Config/env:** `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `NEXT_PUBLIC_MAP_STYLE_URL`. `.env.example` committed.

---

## 9. Testing & CI

- **Unit (Vitest):** `pricing.ts`, `format.ts` (fr date ranges like "8–10 janv.", "30 oct. – 1 nov."), `search/params.ts` round-trip, availability query.
- **Component:** BigSearch interactions, GuestsField counters (min/max rules: adults ≥ 1 when others > 0).
- **E2E (Playwright, Chromium at `/opt/pw-browsers`):** home → search → room → book happy path; wishlist toggle with auth redirect; visual snapshots of home at 390 & 1440 vs `docs/recon/screenshots` as a reference (manual review, not pixel-gated).
- **CI (GitHub Actions):** `pnpm i` → lint → typecheck → unit → `prisma migrate deploy` on SQLite → seed → build → e2e.

---

## 10. Build order (first milestones)

1. `pnpm create next-app`, Tailwind v4, ESLint/Prettier, Vitest, Playwright, CI workflow.
2. `scripts/build-tokens.ts` → `styles/tokens.css`; `components/ui` primitives.
3. Prisma schema + seed (Places with Unsplash images, 300 listings, reviews).
4. Layout shell: Header (static, expanded), Footer, MobileBottomNav.
5. Homepage sections with real seed data + ListingCard + CarouselSection.
6. BigSearch popovers + URL serialisation → stub `/s/[place]/homes` list.
7. Then P2 → P3 → P4 as in §1.

## 11. IP guardrails
Own name/logo, Inter (or similar) instead of Cereal, own icon set (Lucide) instead of Airbnb's 3D tab videos/illustrations, Unsplash/AI-generated imagery, own copy for legal pages. Recon screenshots stay in `docs/` as reference only and are never served by the app.
