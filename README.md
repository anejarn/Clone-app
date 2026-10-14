# Sigma

Sigma is the brand of a Moroccan SARL that will manage high-end short-term rentals in Marrakech. This repository is, for now, its website base: a French-first vacation-rental site rebuilt from a recon of [airbnb.fr](https://www.airbnb.fr/), with its own name, logo, font and imagery. It has 18 destinations, homes, Expériences and Services tabs, search with availability, favourites, accounts, trips and a help page (`/aide`). Stays can be booked through the API only: there is no booking button and no payment in the UI.

History: the replica was built on 12–13 October 2026 under the working name Nidou; a ski-resort pivot was tried on 13–14 October and reverted on 14 October.
The app was renamed Sigma on 14 October 2026, with the pivot's generic fixes (search combobox, date label, input limits, help page, truthful cookie notice) ported back.

- Recon: [`docs/recon/airbnb-fr.md`](docs/recon/airbnb-fr.md)
- Architecture and roadmap: [`docs/architecture.md`](docs/architecture.md)
- Design system: [`docs/design-system.md`](docs/design-system.md), with a static mockup in `design/mockups/home.html` (drawn before the rename)
- What still differs from airbnb.fr: [`docs/replica-diff.md`](docs/replica-diff.md)

## Status

| Phase | State |
|---|---|
| P0 Foundation (Next.js 16, Tailwind v4 tokens, primitives, layout shell) | ✅ |
| P1 Homepage (tabs, search with destination/dates/guests, carousels, cards, inspiration grid, footer, mobile nav and sheet, cookie notice) | ✅ |
| Help page `/aide` (search and prices, trips and cancellation, favourites, account, every cookie and storage key) | ✅ |
| Backend (Postgres + Prisma 7, catalogue, availability, bookings, accounts, favourites, reviews, REST API) | ✅ see [`docs/api.md`](docs/api.md) |
| P2 Search | 🟡 results grid with availability, guests/pets filters and pagination; no map or filter panel yet |
| P3 Listing page with booking card | ⏳ the booking API is ready; `/trips` lists and cancels stays |
| P4 Accounts | 🟡 email/password sign-up and sign-in, favourites synced to the account; no OAuth or profile page |

Photos are random placeholders from picsum.photos.

## Develop

Needs Node 22.18+, pnpm and Postgres 16.

```bash
cp .env.example .env          # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d          # Postgres with `nidou` and `nidou_test` databases (infrastructure names kept from before the rename)
pnpm install                  # also generates the Prisma client
pnpm db:deploy && pnpm db:seed
pnpm dev                      # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` | ESLint, and route-type generation + `tsc` |
| `pnpm test` | Unit tests (`tests/unit`), no database; date tests also run under UTC+14 and UTC−8 |
| `pnpm test:integration` | Server logic against `nidou_test` (`tests/integration`): migrates and reseeds it first |
| `DATABASE_URL=<test db> pnpm build && pnpm test:e2e` | Playwright against the production build and `nidou_test`: user journeys, API contract, security, accessibility (axe), keyboard, timezones, design conformance; desktop and mobile |
| `pnpm test:coverage` | Unit + integration coverage of `lib/` |
| `pnpm db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |
| `pnpm db:seed` | Reload demo data (clears listings, bookings, reviews and favourites; keeps real accounts) |
| `pnpm db:reset` | Drop and recreate the database, then seed. Destructive, dev only |

Demo hosts and guests (`@demo.nidou.fr`, a fixture domain kept from before the rename) have no password; create an account at `/login`.

## Backend at a glance

- **Data**: Postgres via Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`). Schema in `prisma/schema.prisma`; integrity rules Prisma can't express (no overlapping stays, value checks) are hand-written in the first migration.
- **Server code**: `lib/server/` (`catalog`, `bookings`, `wishlist`, `reviews`, `auth`), plain async functions that tests call directly. Pages use the cached wrappers in `lib/data/repo.ts` (`"use cache"`, tags `listings` and `availability`).
- **Auth**: [Better Auth](https://www.better-auth.com) with email + password and the Prisma adapter, chosen over Auth.js v5 (still in beta; its maintainers moved to Better Auth).
- **API**: `app/api/*`, documented in [`docs/api.md`](docs/api.md).
- **QA**: findings, fixes, Lighthouse and parity results in [`docs/qa-report.md`](docs/qa-report.md).

Next.js 16 runs with Cache Components: data functions use `"use cache"` + `cacheLife`, and anything that reads request data (params, search params, cookies) must sit inside `<Suspense>`. See `AGENTS.md` and the docs bundled in `node_modules/next/dist/docs/`.
