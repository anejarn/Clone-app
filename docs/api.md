# API

JSON over HTTP, served by Next.js Route Handlers in `app/api/`. Business rules live in `lib/server/*`; routes only parse input, check the session and map errors.

- **Errors**: `{ "error": { "code": "UNAVAILABLE", "message": "Ces dates ne sont plus disponibles." } }` with a matching status (400 invalid input, 401 signed out, 403 forbidden, 404 not found, 409 conflict, 413 body too large, 422 rule violated). Messages are French and safe to show.
- **Input limits**: JSON bodies are read as a stream and refused with `413 PAYLOAD_TOO_LARGE` past 64 KB (16 KB for `POST /api/host-leads`), before parsing. Ids in paths and bodies must match `[A-Za-z0-9_-]{1,64}`; anything else is answered as unknown (`404 NOT_FOUND`, or `400` inside a body) without a query. Free-text fields refuse control characters (NUL included), except tabs and line breaks.
- **Auth**: session cookie set by Better Auth (`/api/auth/*`). Writes also require a same-origin `Origin` header when one is sent (browsers always send it).
- **Dates**: `yyyy-MM-dd`, checkout exclusive. Money: integer cents EUR.
- **Catalogue**: homes (apartments, studios, chalets) in two Hautes-Alpes resorts, `orcieres-merlette` (Orcières-Merlette 1850, commune INSEE 05096) and `les-orres` (Les Orres, 05098). No experiences.

## Catalogue (public)

| Method & path | Query / body | Returns |
|---|---|---|
| `GET /api/autosuggest` | `q` (optional) | `{ places: Place[] }` (`slug, name, country, tagline, image, altitudeM`), accent/case-insensitive, prefix matches first, every resort when `q` is empty |
| `GET /api/listings` | `place` (slug or `partout`), `checkin`, `checkout`, `adults`, `children`, `infants`, `pets`, `type` (`studio` \| `appartement` \| `chalet`), `ski` (`1`: lift within 50 m), `pinned`, `page` (past the last page: empty); unknown filter values are ignored | `{ place, total, page, pageCount, nights, items: CardData[] }`, 24 per page, only homes free on the dates and whose minimum stay fits them, sleeping enough guests, pet-friendly when `pets > 0`, of the requested type and distance. Each card's `href` is its listing page (`/rooms/:id`, with the searched dates and guests) and `facts` reads "Meublé 3★ · Ski aux pieds". With dates, `price` is the all-in guest total for the searched guests (one adult when none are given); `stars`, `liftDistanceM`, `minNights` on each card |
| `GET /api/listings/:id` | | Listing with photos, amenities, host (name, `isProfessional`; not the commission tier), place (`inseeCode`, `altitudeM`), `stars` (null = unclassified), `registrationNumber`, `liftDistanceM`, `minNights`, `dpeClass` and the 6 latest reviews |
| `GET /api/listings/:id/availability` | `from`, `to` (default: today + 1 year) | `{ listingId, from, to, minNights, booked: [{ checkIn, checkOut }] }` · `404` for unknown listings |
| `GET /api/listings/:id/quote` | `checkin`, `checkout`, `adults`, `children`, `infants`, `pets` | `{ available, nights, nightlyCents, stayCents, cleaningFeeCents, touristTaxCents, totalCents, minNights }`; `stayCents + cleaningFeeCents + touristTaxCents = totalCents`. Guest lines only: the commission and host payout are never returned · `422 MIN_NIGHTS` and the other booking rules below |
| `GET /api/listings/:id/calendar.ics` | | `text/calendar` (RFC 5545, CRLF): one all-day `VEVENT` per confirmed stay (`UID:<bookingId>@nidou.fr`, `DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE` = checkout day, exclusive, `SUMMARY:Réservé (Nidou)`, `DTSTAMP` = the booking's creation, so no `METHOD` property), no guest data, `Cache-Control: no-store`. Owners import it into their other channels so nights sold on Nidou are blocked there · `404` for unknown listings |

## Owners (public)

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/host-leads` | `{ name (1–100), email (≤ 254), phone? (≤ 30), placeSlug ("orcieres-merlette" \| "les-orres"), propertyType ("APARTMENT" \| "STUDIO" \| "CHALET"), beds (integer 1–30), openWinterWeeks (integer 1–26), registrationNumber?, message? (≤ 2000), consent: true }` | `201 { ok: true }`, nothing stored is echoed · `400 INVALID_INPUT` (including `consent` not `true`, an unknown resort, or a registration number that isn't 5 + 6 digits + 2 letters from that resort's commune; spaces and lower case are normalised) · `403 BAD_ORIGIN` · `413 PAYLOAD_TOO_LARGE` over 16 KB. Unknown keys are refused (`400`). No read endpoint (`GET` is `405`) |

## Account (signed in)

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/sign-up/email` · `sign-in/email` · `sign-out` | `{ name, email, password }` | Better Auth; sets the session cookie |
| `GET /api/bookings` | | `{ bookings }`, latest stay first |
| `POST /api/bookings` | `{ listingId, checkIn, checkOut, adults, children?, infants?, pets? }` | `201` booking with the guest's price lines (`nightlyCents, cleaningFeeCents, touristTaxCents, totalCents`) · `409 UNAVAILABLE` · `422 INVALID_DATES / MIN_NIGHTS / TOO_MANY_GUESTS / PETS_NOT_ALLOWED / NOT_BOOKABLE` · `403 OWN_LISTING` |
| `POST /api/bookings/:id/cancel` | | Cancelled booking (record kept) · `409 NOT_CANCELLABLE` once started or already cancelled · `404` for other users' bookings |
| `GET /api/wishlist` | | `{ ids }`, most recent first |
| `POST /api/wishlist` | `{ ids }` | Merges favourites saved while signed out; returns `{ ids }` |
| `PUT` / `DELETE /api/wishlist/:listingId` | | `204`, idempotent |
| `POST /api/listings/:id/reviews` | `{ rating: 1–5, body }` | `201` · `403 NO_STAY` without a completed stay · `409 ALREADY_REVIEWED` (one per stay) |

## Booking rules

- Stays start today or later (today = the listing's local date, from `Place.timezone`), at most 365 days ahead, and last 1–60 nights; cancellation closes on the listing's local arrival day.
- Any arrival day. At least the listing's `minNights` (2 by default, 3 for some homes): shorter stays get `422 MIN_NIGHTS`, "Ce logement se réserve pour 3 nuits minimum.".
- `adults + children ≤ maxGuests`; at least one adult; pets need the "Animaux acceptés" amenity.
- Price is computed on the server (`lib/pricing.ts`) and snapshotted on the booking. Guests pay no service fee:
  - **Guest total** = nightly × nights + cleaning + taxe de séjour.
  - **Taxe de séjour** (`lib/tourist-tax.ts`), collected by Nidou for the commune, per adult per night, 10 % Hautes-Alpes surcharge included. Classified homes (1–5★): Orcières (2026 grid, deliberation of 2 June 2025) €0.88 / 0.99 / 1.21 / 1.32 / 3.30; Les Orres (deliberation in force since 2024) €0.88 / 0.99 / 1.54 / 2.09 / 2.75. Unclassified homes: 5.5 % of the nightly price divided by all occupants (adults + children + infants), rounded to the cent, capped at €4.40 (Orcières) or €3.08 (Les Orres). Minors are exempt; the guest picker's "Adultes" are 13+, so teenagers are counted as adults.
  - **Owner side** (never returned to guests): commission on the base (nightly × nights + cleaning), 10 % or 5 % for founding hosts on stays checking in on or before 2027-04-30, plus 20 % VAT on the commission; payout = base − commission − VAT. Stored as `commissionBps`, `commissionCents`, `commissionVatCents`, `hostPayoutCents`.
  - Postgres checks that payout + commission + VAT = base and total = base + tax on every new booking.
- **No double booking**: checked in the transaction, and guaranteed by the Postgres exclusion constraint `bookings_no_overlap` (GiST on listing + `daterange`, confirmed stays only). Concurrent requests for the same dates: exactly one succeeds (see `tests/integration/bookings.test.ts`).
- Guests cancel their own confirmed stays until the day before arrival; cancelled dates become bookable again.
