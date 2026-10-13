# API

JSON over HTTP, served by Next.js Route Handlers in `app/api/`. Business rules live in `lib/server/*`; routes only parse input, check the session and map errors.

- **Errors**: `{ "error": { "code": "UNAVAILABLE", "message": "Ces dates ne sont plus disponibles." } }` with a matching status (400 invalid input, 401 signed out, 403 forbidden, 404 not found, 409 conflict, 422 rule violated). Messages are French and safe to show.
- **Auth**: session cookie set by Better Auth (`/api/auth/*`). Writes also require a same-origin `Origin` header when one is sent (browsers always send it).
- **Dates**: `yyyy-MM-dd`, checkout exclusive. Money: integer cents EUR.

## Catalogue (public)

| Method & path | Query / body | Returns |
|---|---|---|
| `GET /api/autosuggest` | `q` (optional) | `{ places: Place[] }`, accent/case-insensitive, prefix matches first, popular places when `q` is empty |
| `GET /api/listings` | `place` (slug or `partout`), `checkin`, `checkout`, `adults`, `children`, `infants`, `pets`, `pinned`, `page` | `{ place, total, page, pageCount, nights, items: CardData[] }`, 24 per page, only homes free on the dates, sleeping enough guests, pet-friendly when `pets > 0` |
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

- Stays start today or later, at most 365 days ahead, last 1–60 nights.
- `adults + children ≤ maxGuests`; at least one adult; pets need the "Animaux acceptés" amenity.
- Price is computed on the server: nightly × nights + cleaning + 14 % service fee, stored on the booking.
- **No double booking**: checked in the transaction, and guaranteed by the Postgres exclusion constraint `bookings_no_overlap` (GiST on listing + `daterange`, confirmed stays only). Concurrent requests for the same dates: exactly one succeeds (see `tests/integration/bookings.test.ts`).
- Guests cancel their own confirmed stays until the day before arrival; cancelled dates become bookable again.
