# API

Sigma's JSON API over HTTP, served by Next.js Route Handlers in `app/api/`. Business rules live in `lib/server/*`; routes only parse input, check the session and map errors.

- **Errors**: `{ "error": { "code": "UNAVAILABLE", "message": "Ces dates ne sont plus disponibles." } }` with a matching status (400 invalid input, 401 signed out, 403 forbidden, 404 not found, 409 conflict, 413 body too large, 422 rule violated). Messages are French and safe to show.
- **Input limits** (`lib/server/http.ts`, `lib/server/schemas.ts`), on every route including `/api/auth/*`: request bodies are read as a stream and refused past 64 KB with `413 PAYLOAD_TOO_LARGE`; free text (search query, place, review body, account name) with a control character other than tab or line break is `400 INVALID_INPUT`; an id that isn't 1–64 characters of `A-Z a-z 0-9 _ -` is answered `404 NOT_FOUND` without a database query (`DELETE /api/wishlist/:id` answers `204`, as for any id not saved; in a body it is `400 INVALID_INPUT`).
- **Auth**: session cookie set by Better Auth (`/api/auth/*`). Writes also require a same-origin `Origin` header when one is sent (browsers always send it).
- **Dates**: `yyyy-MM-dd`, checkout exclusive. Money: integer centimes of dirham (MAD).

## Catalogue (public)

| Method & path | Query / body | Returns |
|---|---|---|
| `GET /api/autosuggest` | `q` (optional) | `{ places: Place[] }`, accent/case-insensitive, prefix matches first, popular places when `q` is empty |
| `GET /api/listings` | `place` (slug or `partout`), `checkin`, `checkout`, `adults`, `children`, `infants`, `pets`, `pinned`, `page` (past the last page: empty) | `{ place, total, page, pageCount, nights, items: CardData[] }`, 24 per page, only homes free on the dates, sleeping enough guests, pet-friendly when `pets > 0` |
| `GET /api/listings/:id` | | Listing with photos, amenities, host and the 6 latest reviews |
| `GET /api/listings/:id/availability` | `from`, `to` (default: today + 1 year) | `{ booked: [{ checkIn, checkOut }] }` |
| `GET /api/listings/:id/quote` | `checkin`, `checkout`, `adults`, `children`, `infants`, `pets` | `{ available, nights, nightlyCents, stayCents, cleaningFeeCents, serviceFeeCents, totalCents }`; the lines always sum to the total |

## Account (signed in)

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/sign-up/email` · `sign-in/email` · `sign-out` | `{ name, email, password }` | Better Auth; sets the session cookie |
| `GET /api/bookings` | | `{ bookings }`, latest stay first |
| `POST /api/bookings` | `{ listingId, checkIn, checkOut, adults, children?, infants?, pets? }` | `201` booking with a price snapshot · `409 UNAVAILABLE` · `422 INVALID_DATES / TOO_MANY_GUESTS / PETS_NOT_ALLOWED / NOT_BOOKABLE` · `403 OWN_LISTING` |
| `POST /api/bookings/:id/cancel` | | Cancelled booking (record kept) · `409 NOT_CANCELLABLE` once started or already cancelled · `404` for other users' bookings |
| `GET /api/wishlist` | | `{ ids }`, most recent first |
| `POST /api/wishlist` | `{ ids }` | Merges favourites saved while signed out; returns `{ ids }` |
| `PUT` / `DELETE /api/wishlist/:listingId` | | `204`, idempotent |
| `POST /api/listings/:id/reviews` | `{ rating: 1–5, body }` | `201` · `403 NO_STAY` without a completed stay · `409 ALREADY_REVIEWED` (one per stay) |

## Booking rules

- Stays start today or later (today = the listing's local date, from `Place.timezone`), at most 365 days ahead, and last 1–60 nights; cancellation closes on the listing's local arrival day.
- `adults + children ≤ maxGuests`; at least one adult; pets need the "Animaux acceptés" amenity.
- Price is computed on the server: nightly × nights + cleaning, stored on the booking (`serviceFeeCents` stays in the response and is 0: Sigma charges guests no service fee).
- **No double booking**: checked in the transaction, and guaranteed by the Postgres exclusion constraint `bookings_no_overlap` (GiST on listing + `daterange`, confirmed stays only). Concurrent requests for the same dates: exactly one succeeds (see `tests/integration/bookings.test.ts`).
- Guests cancel their own confirmed stays until the day before arrival; cancelled dates become bookable again.
