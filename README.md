# Sigma

Sigma is the application of Sigma SARL (Marrakech): short-term rental management and guest concierge, with condominium management (syndic) to follow in V2. See [`CLAUDE.md`](CLAUDE.md) for the product brief and [`TACHES_SIGMA.md`](TACHES_SIGMA.md) for the work plan by lot.

This repository is, for now, the guest-facing website: a French-first rental site covering ten Marrakech neighbourhoods (Hivernage, Guéliz, Médina, Palmeraie, Agdal, Targa, Route de l'Ourika, Agafay, Semlalia, Ménara), with homes, activities and concierge tabs, search with availability, favourites, accounts, stays (`/trips`) and a help page (`/aide`, including Sigma's offer to owners). Prices are in dirhams (MAD), dates in JJ/MM/AAAA, times in Africa/Casablanca; there is no guest service fee. Stays can be booked through the API only: there is no booking button and no payment in the UI yet. It started as a functional replica built from a recon of a large rental marketplace, used as functional inspiration only: name, logo (Σ), Majorelle-blue colours, texts and imagery are Sigma's.

History: the replica was built on 12–13 October 2026 under the working name Nidou; a ski-resort pivot was tried on 13–14 October and reverted on 14 October.
The app was renamed Sigma on 14 October 2026, with the pivot's generic fixes (search combobox, date label, input limits, help page, truthful cookie notice) ported back.

- Recon: [`docs/recon/airbnb-fr.md`](docs/recon/airbnb-fr.md)
- Architecture and roadmap: [`docs/architecture.md`](docs/architecture.md)
- Design system: [`docs/design-system.md`](docs/design-system.md), with a static mockup in `design/mockups/home.html` (drawn before the rename)
- Differences from the recon: [`docs/replica-diff.md`](docs/replica-diff.md)

## Status

Sigma lots ([`TACHES_SIGMA.md`](TACHES_SIGMA.md)):

| Lot | State |
|---|---|
| Lot 0 Sigma identity (name, Σ logo, Majorelle blue, footer, MAD, no service fee, Marrakech demo data, concierge content) | ✅ |
| Lot 1 Sigma data model (roles, owners, platform bookings, organisations) | ✅ organisations (users, listings, bookings, reviews, wishlists), roles, owners and listing terms, booking sources (direct, Airbnb, Booking.com, Agoda, Trip.com, Expedia, owner blocks) with their database rules |
| Lot 2 Back-office | 🟡 `/admin` for the team with server-side access control (`lib/server/authz.ts`) and compulsory double authentification (TOTP) for ADMIN and AGENT; dashboard (biens, réservations à venir, autorisations 80-14 to renew); **Biens** (ADMIN): list with filters and 80-14 badges, fiche, create/edit (photos, équipements, address and coordinates, house rules, owner, management type and commission, 80-14 authorisation with its 60-day alert, price, cleaning fee, minimum stay, draft/published); **Utilisateurs** (ADMIN): members with role, 2FA status and last sign-in, invitations of owners, agents and admins by a single-use 7-day link (copy or WhatsApp share; no e-mail/WhatsApp provider yet), role changes, 2FA reset after a lost phone, soft deactivation, audit trail; **Calendrier** (ADMIN, AGENT): timeline of every home (14/30/60 nights, week/month navigation, jump to a date, neighbourhood and title filters), bookings as bars coloured by source with a legend, owner blocks hatched, cancelled hidden, detail panel on click, per-home agenda on phones; **Réservations** (ADMIN, AGENT): list filtered by source, home, dates and status, booking page; **Nouvelle saisie** (ADMIN only): direct booking by phone/WhatsApp (no account, priced from the home, price overridable), platform booking typed by hand (code required, amount optional), owner block (dates + reason), change of dates, cancellation, all audited; agents see guests and phones, never amounts; Prix is a "Bientôt" placeholder |
| Lots 3–9 (field operations, welcome guide and concierge, guest declaration, iCal sync, finances, dashboards) | ⏳ |

Replica phases, before the Sigma lots:

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
docker compose up -d          # Postgres 16: role `sigma` (password `sigma`), databases `sigma` and `sigma_test`
pnpm install                  # also generates the Prisma client
pnpm db:deploy && pnpm db:seed
pnpm dev                      # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` | ESLint, and route-type generation + `tsc` |
| `pnpm test` | Unit tests (`tests/unit`), no database; date tests also run under UTC+14 and UTC−8 |
| `pnpm test:integration` | Server logic against `sigma_test` (`tests/integration`): migrates and reseeds it first |
| `DATABASE_URL=<test db> pnpm build && pnpm test:e2e` | Playwright against the production build and `sigma_test`: user journeys, API contract, security, accessibility (axe), keyboard, timezones, design conformance; desktop and mobile |
| `pnpm test:coverage` | Unit + integration coverage of `lib/` |
| `pnpm db:migrate` | Create/apply a migration after editing `prisma/schema.prisma` |
| `pnpm db:seed` | Reload demo data (clears listings, bookings, reviews and favourites; keeps real accounts) |
| `pnpm db:reset` | Drop and recreate the database, then seed. Destructive, dev only |

To reseed the test database too: `DATABASE_URL="postgresql://sigma:sigma@localhost:5432/sigma_test?schema=public" pnpm db:seed`.

### Demo accounts

Seeded in the dev and test databases only (never when `NODE_ENV=production`); tests create their own accounts under `@test.sigma.test`. Every other demo user (`@demo.sigma.test`) has no password.

| Account | Role | Password | Double authentification |
|---|---|---|---|
| `amine@demo.sigma.test` | ADMIN (associé) | `sigma-demo-2026` | on: TOTP key `ONUWO3LBFVSGK3LPFV2G65DQFVXG65BNMZXXELLQOJXWI5LDORUW63Q`, backup codes `demo0-00001` … `demo0-00010` |
| `agent1@demo.sigma.test` | AGENT (agent terrain) | `sigma-demo-2026` | on, same key and backup codes |
| `felicia@demo.sigma.test` | ADMIN | `sigma-demo-2026` | off: asked to enroll on her first visit to `/admin` |
| `hassan.benjelloun@demo.sigma.test` | OWNER | `sigma-demo-2026` | none (no back-office access) |
| `voyageur1@demo.sigma.test` | GUEST | `sigma-demo-2026` | none |

Add the TOTP key to an authenticator app (account type "time based") to get the codes. The seed encrypts it with `BETTER_AUTH_SECRET`, so seed and app must share that secret: after changing it, run `pnpm db:seed` again (the test suites pass their own secret to the seed). The key and codes are public: never seed a production database.

### Listing photos (uploads)

Photos uploaded in Biens are stored by `lib/storage/` (interface `FileStorage`). The only store for now writes to the local disk under `UPLOAD_DIR` (default `./uploads`, git-ignored: back it up with the database); choosing a cloud store (S3-compatible bucket, region, loi 09-08 transfer) is left to the associés, and plugs in by writing another `FileStorage` in `lib/storage/index.ts`. Files are served by `GET /media/<key>`: photos of published listings to anyone, a draft's photos only to staff of its organization. JPEG, PNG or WebP (checked by content), 5 MB at most, 30 per listing.

### Back-office access

`/admin` is for organization members with role ADMIN (associé, everything) or AGENT (agent terrain: Tableau de bord, Réservations, Calendrier). The sections and their roles are listed once in `lib/admin/sections.ts`; each page calls `requireAdminPage(href)`, each server action `requireAdminAction(href)` and each Route Handler `requireAdminApi(request, href)` (`lib/server/authz.ts`). Without a session, `proxy.ts` sends `/admin/*` to `/login?next=…` (HTTP 307); guests, owners and agents on an admin-only section get the "Page introuvable" page (the pages stream, so the status stays 200; the API answers 401/403); staff without double authentification are sent to `/admin/securite` to enroll (QR code or key, then backup codes). Roles and 2FA status are read from the database on every request, so a change applies at once.

### Bookings in the back-office

`/admin/calendrier` and `/admin/reservations` (ADMIN and AGENT) read every booking of the organization; amounts (nightly, cleaning, total) are sent to ADMIN only (`canSeeBookingAmounts`, `lib/admin/sections.ts`): an agent's data has no amounts at all. Writing (`/admin/reservations/nouvelle`, change of dates, cancellation) is ADMIN only, owner blocks included (`BOOKING_ENTRY_PATH`). Rules (`lib/server/admin/bookings.ts`): the home is a HOME of the organization (drafts allowed); departure after today, arrival at most two years ahead, 365 nights at most; overlaps with any confirmed booking or owner block are refused with the booking in the way (pre-check, then the `bookings_no_overlap` constraint under concurrent writes); a direct booking needs a name and a phone or e-mail and a channel, is priced nightly × nights + cleaning with the home's prices unless typed (total > 0), and respects the home's minimum stay unless the associé ticks « Accepter un séjour plus court » (noted in the audit trail); a platform booking needs its platform and code (unique per platform in the organization), its amount (total, of which cleaning) is optional and the stored nightly price is the average; changing a direct booking's dates re-prices it at its own nightly price, a platform booking keeps its total. Cancelling keeps the row (status CANCELLED); a stay that is over can't be changed or cancelled. Every write goes to `audit_logs` without the guest's contact. Colours are Sigma's own palette (text labels for the platforms, no logos), checked for contrast in `tests/unit/booking-sources.test.ts`.

### Users and invitations

`/admin/utilisateurs` (ADMIN only) lists the organization's members and invites new ones as OWNER, AGENT or ADMIN. An invitation is a link `/invitation/<token>`: 256 random bits shown once to the admin, stored only as a SHA-256 hash, valid 7 days and once; "Renvoyer" issues a new link (the old one stops working), "Révoquer" cancels it. The invitee creates a name and password, or, if an account with that e-mail exists, signs in and accepts (an account of another organization can't be moved); staff are then sent to double authentification enrollment. Public sign-up still always gives a GUEST without organization. No e-mail or WhatsApp provider is chosen yet: messages go through `lib/notifications/` (interface `Notifier`, default sends nothing; `NOTIFICATIONS_DRIVER=console` prints them in development), so the admin copies the link or uses the "Partager sur WhatsApp" wa.me link. A member's page changes the role (refused for the last active ADMIN and for an owner who still owns listings), resets double authentification (acting admin's password + confirmation, never on oneself) and deactivates or reactivates the account (no sign-in, nothing deleted). Role changes, 2FA resets and deactivations revoke the person's sessions; every such action is written to `audit_logs` (who, what, target, when). Rules: `lib/server/admin/users.ts`, `lib/server/invitations.ts`.

### Docker volume created before the rename

A Postgres volume created when the app was still called Nidou has a `nidou` role and `nidou` / `nidou_test` databases. Rename them in place, keeping every row; do not delete the volume. Stop the app first (no open connections to the databases), then:

```bash
docker compose exec -T db psql -U nidou -d postgres <<'SQL'
CREATE ROLE sigma_tmp LOGIN SUPERUSER PASSWORD 'tmp';
SQL
docker compose exec -T db psql -U sigma_tmp -d postgres <<'SQL'
ALTER ROLE nidou RENAME TO sigma;
ALTER ROLE sigma WITH PASSWORD 'sigma';
ALTER DATABASE nidou RENAME TO sigma;
ALTER DATABASE nidou_test RENAME TO sigma_test;
SQL
docker compose exec -T db psql -U sigma -d postgres -c "ALTER ROLE sigma_tmp NOLOGIN;"
```

A role cannot rename itself while connected, hence the temporary role, disabled at the end (it owns nothing). Then update `DATABASE_URL` in `.env` as in `.env.example`.

## Backend at a glance

- **Data**: Postgres via Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`). Schema in `prisma/schema.prisma`; integrity rules Prisma can't express (no overlapping stays, value checks) are hand-written in the first migration.
- **Server code**: `lib/server/` (`catalog`, `bookings`, `wishlist`, `reviews`, `auth`), plain async functions that tests call directly. Pages use the cached wrappers in `lib/data/repo.ts` (`"use cache"`, tags `listings` and `availability`).
- **Auth**: [Better Auth](https://www.better-auth.com) with email + password and the Prisma adapter, chosen over Auth.js v5 (still in beta; its maintainers moved to Better Auth).
- **API**: `app/api/*`, documented in [`docs/api.md`](docs/api.md).
- **QA**: findings, fixes, Lighthouse and parity results in [`docs/qa-report.md`](docs/qa-report.md).

Next.js 16 runs with Cache Components: data functions use `"use cache"` + `cacheLife`, and anything that reads request data (params, search params, cookies) must sit inside `<Suspense>`. See `AGENTS.md` and the docs bundled in `node_modules/next/dist/docs/`.
