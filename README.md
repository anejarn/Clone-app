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
| Lot 2 Back-office | ✅ `/admin` for the team with server-side access control (`lib/server/authz.ts`) and compulsory double authentification (TOTP) for ADMIN and AGENT; dashboard (biens, réservations à venir, autorisations 80-14 to renew); **Biens** (ADMIN): list with filters and 80-14 badges, fiche, create/edit (photos, équipements, address and coordinates, house rules, owner, management type and commission, 80-14 authorisation with its 60-day alert, price, cleaning fee, minimum stay, draft/published); **Utilisateurs** (ADMIN): members with role, 2FA status and last sign-in, invitations of owners, agents and admins by a single-use 7-day link (copy or WhatsApp share; no e-mail/WhatsApp provider yet), role changes, 2FA reset after a lost phone, soft deactivation, audit trail; **Calendrier** (ADMIN, AGENT): timeline of every home (14/30/60 nights, week/month navigation, jump to a date, neighbourhood and title filters), bookings as bars coloured by source with a legend, owner blocks hatched, cancelled hidden, detail panel on click, per-home agenda on phones; **Réservations** (ADMIN, AGENT): list filtered by source, home, dates and status, booking page; **Nouvelle saisie** (ADMIN only): direct booking by phone/WhatsApp (no account, priced from the home, price overridable), platform booking typed by hand (code required, amount optional), owner block (dates + reason), change of dates, cancellation, all audited; agents see guests and phones, never amounts; **Prix** (ADMIN): seasons and events (percentage of the base price or fixed price for one home, optional minimum stay, yearly or one-off, for every home, a selection or one home), list with filters, create/edit/delete (audited), price calendar per home (30/60/90 nights); one pricing engine (`lib/pricing/engine.ts`) for the quote, bookings, search cards and the team's direct bookings |
| Lot 3 Field operations | 🟡 **Opérations** (ADMIN) and **Mes tâches** (ADMIN, AGENT): tasks generated with every booking (linen and welcome on arrival, cleaning after departure, same-day turnover flagged), manual tasks, assignment, status à faire / en cours / fait, check-lists with required photos (see « Field tasks » below); breakdown reports and the offline « Ma journée » to come |
| Lots 4–9 (welcome guide and concierge, guest declaration, iCal sync, finances, dashboards) | ⏳ |

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

`/admin` is for organization members with role ADMIN (associé, everything) or AGENT (agent terrain: Tableau de bord, Réservations, Calendrier, Mes tâches). The sections and their roles are listed once in `lib/admin/sections.ts`; each page calls `requireAdminPage(href)`, each server action `requireAdminAction(href)` and each Route Handler `requireAdminApi(request, href)` (`lib/server/authz.ts`). Without a session, `proxy.ts` sends `/admin/*` to `/login?next=…` (HTTP 307); guests, owners and agents on an admin-only section get the "Page introuvable" page (the pages stream, so the status stays 200; the API answers 401/403); staff without double authentification are sent to `/admin/securite` to enroll (QR code or key, then backup codes). Roles and 2FA status are read from the database on every request, so a change applies at once.

### Bookings in the back-office

`/admin/calendrier` and `/admin/reservations` (ADMIN and AGENT) read every booking of the organization; amounts (nightly, cleaning, total) are sent to ADMIN only (`canSeeBookingAmounts`, `lib/admin/sections.ts`): an agent's data has no amounts at all. Writing (`/admin/reservations/nouvelle`, change of dates, cancellation) is ADMIN only, owner blocks included (`BOOKING_ENTRY_PATH`). Rules (`lib/server/admin/bookings.ts`): the home is a HOME of the organization (drafts allowed); departure after today, arrival at most two years ahead, 365 nights at most; overlaps with any confirmed booking or owner block are refused with the booking in the way (pre-check, then the `bookings_no_overlap` constraint under concurrent writes); a direct booking needs a name and a phone or e-mail and a channel, is priced by the pricing engine (each night at the home's base price or its season's or event's, + cleaning) unless a nightly price is typed (then every night at it; total > 0), and respects the stay's minimum (the home's, raised by the rules) unless the associé ticks « Accepter un séjour plus court » (noted in the audit trail); a platform booking needs its platform and code (unique per platform in the organization), its amount (total, of which cleaning) is optional and the stored nightly price is the average; changing a direct booking's dates re-prices it at its own nightly price, a platform booking keeps its total. Cancelling keeps the row (status CANCELLED); a stay that is over can't be changed or cancelled. Every write goes to `audit_logs` without the guest's contact. Colours are Sigma's own palette (text labels for the platforms, no logos), checked for contrast in `tests/unit/booking-sources.test.ts`.

### Prices (Prix)

`/admin/prix` (ADMIN only) holds the organization's price rules (`price_rules`, `price_rule_listings`): a **season** or an **event**, named, from a first to a last night (both included), one-off or every year (a range across 31/12 is fine), for every home, a selection or one home. A rule sets a percentage of the base price (−90 % to +500 %, rounded to the whole dirham, never under 1 MAD; 0 % = minimum stay only) or a fixed nightly price (one home only), and optionally a minimum stay. The engine (`lib/pricing/engine.ts`, pure, unit-tested in `tests/unit/pricing-engine.test.ts`) prices each night with one rule: one home > a selection > every home, then event > season, then priority (0–100), then the most recent; no rule = the listing's base price, untouched. A stay's minimum is the largest of the listing's `minNights` and the `minNights` of every rule covering one of its nights. Used by the quote and booking (`lib/server/bookings.ts`), search and homepage cards (stay totals, and only homes whose minimum fits the dates), and the team's direct bookings (preview in the browser with the same engine). Bookings store `nightlyCents` = the average of the nights (rounded to the centime) and `totalCents` = the exact sum. The base price and `minNights` of a home stay in Biens; its price calendar is at `/admin/prix/apercu?bien=<id>`. Prices don't go through iCal: report a change on each platform by hand (lot 7). The seed adds Marrakech demo rules for selections of homes (spring and autumn high seasons, year-end holidays with 3 nights minimum, Marathon 2027, Ramadan 2027).

### Field tasks (Opérations, Mes tâches)

Every confirmed guest stay (direct from the site or typed by the team, or a platform booking; any future import goes through the same function) gets three tasks, in the same transaction as the booking (`lib/operations/sync.ts`, `syncBookingTasks`): **linen** (arrival day, from check-out to check-in time), **welcome** (arrival day, check-in time + 2 h) and **cleaning** (departure day, from check-out to check-in time). Times are the organization's (`organizations.checkInMinutes` / `checkOutMinutes`, 15:00 and 11:00 by default) unless the home has its own (`listings.checkInMinutes` / `checkOutMinutes`; no settings screen yet), computed in Africa/Casablanca with the runtime's time zone rules, Ramadan's UTC+0 included (`lib/operations/schedule.ts`). Rules: owner blocks get no task (a cleaning after an owner's stay is added by hand); new dates move the tasks not started yet, and a time an associé typed survives a re-sync as long as the stay's dates don't change; a cancelled stay cancels its TODO tasks and keeps the started and done ones; a cleaning is flagged « Départ et arrivée le même jour » when another stay or an owner block arrives that day; no task is created for a day already past; generation is idempotent (one task per booking and type, `tasks_bookingId_type_key`).

Each task gets a copy of its type's check-list (`checklist_templates`, French defaults in `lib/operations/checklist.ts`: rooms, bathroom, kitchen, bins, linen, photos of each room…; keys, Wi-Fi, house rules, meter photo…). `/admin/operations` (ADMIN) lists the tasks by day (filters: dates, home, agent or « non affectées », status, type), assigns them (active ADMIN or AGENT of the organization only, also checked by the `tasks_assignee_check` trigger), changes their day and times, notes, cancels and reopens them, and adds manual tasks; `/admin/mes-taches` (ADMIN, AGENT) shows the tasks assigned to the person signed in for today and tomorrow, on a phone first: start, tick, take photos (`capture="environment"`, JPEG/PNG/WebP, shrunk in the browser above 600 KB, 5 MB at most, stored by `lib/storage` under `tasks/<organization>/<task>/`), finish. **An agent only sees and acts on the tasks assigned to them** (an unassigned or a colleague's task is « introuvable »); an associé on every task. A task becomes « fait » only when every item is ticked and every item that requires a photo has one, checked by the server in a transaction holding the task's row. Task photos are served by `/media` only to the organization's staff, never cached. Assignments, new times and status changes are audited; deactivating a member or giving them a non-staff role puts their open tasks back to « non affectée ». The dashboard counts today's tasks and the unassigned ones.

After the migration `20261025090000_field_tasks` on a database with real bookings, run `pnpm tasks:backfill` once (idempotent) to create the tasks of the stays already there: the migration doesn't, because the Postgres time zone data can lag behind for Morocco (Ubuntu 24.04's stops at September 2026). `pnpm db:seed` does it for the demo data and shares the coming week's tasks between the two demo agents.

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
