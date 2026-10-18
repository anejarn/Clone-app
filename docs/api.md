# API

Sigma's JSON API over HTTP, served by Next.js Route Handlers in `app/api/`. Business rules live in `lib/server/*`; routes only parse input, check the session and map errors.

- **Errors**: `{ "error": { "code": "UNAVAILABLE", "message": "Ces dates ne sont plus disponibles." } }` with a matching status (400 invalid input, 401 signed out, 403 forbidden, 404 not found, 409 conflict, 413 body too large, 422 rule violated). Messages are French and safe to show.
- **Input limits** (`lib/server/http.ts`, `lib/server/schemas.ts`), on every route including `/api/auth/*`: request bodies are read as a stream and refused past 64 KB with `413 PAYLOAD_TOO_LARGE`; free text (search query, place, review body, account name) with a control character other than tab or line break is `400 INVALID_INPUT`; an id that isn't 1–64 characters of `A-Z a-z 0-9 _ -` is answered `404 NOT_FOUND` without a database query (`DELETE /api/wishlist/:id` answers `204`, as for any id not saved; in a body it is `400 INVALID_INPUT`).
- **Auth**: session cookie set by Better Auth (`/api/auth/*`). Writes also require a same-origin `Origin` header when one is sent (browsers always send it).
- **Dates**: `yyyy-MM-dd`, checkout exclusive. Money: integer centimes of dirham (MAD).
- **Drafts**: only published listings exist for the public routes (search, detail, availability, quote, booking, favourites); a draft answers `404` like an unknown id.

## Catalogue (public)

| Method & path | Query / body | Returns |
|---|---|---|
| `GET /api/autosuggest` | `q` (optional) | `{ places: Place[] }`, accent/case-insensitive, prefix matches first, popular places when `q` is empty |
| `GET /api/listings` | `place` (slug or `partout`), `checkin`, `checkout`, `adults`, `children`, `infants`, `pets`, `pinned`, `page` (past the last page: empty) | `{ place, total, page, pageCount, nights, items: CardData[] }`, 24 per page, only homes free on the dates and whose minimum stay (seasons and events included) fits them, sleeping enough guests, pet-friendly when `pets > 0`; with dates a card's price is the stay's total, as the quote |
| `GET /api/listings/:id` | | Listing with photos, amenities, `minNights`, `houseRules` and the 6 latest reviews; never the owner, commission, address or 80-14 authorisation |
| `GET /api/listings/:id/availability` | `from`, `to` (default: today + 1 year) | `{ booked: [{ checkIn, checkOut }] }` |
| `GET /api/listings/:id/quote` | `checkin`, `checkout`, `adults`, `children`, `infants`, `pets` | `{ available, nights, nightPrices: [{ date, priceCents }], nightlyCents, stayCents, cleaningFeeCents, serviceFeeCents, totalCents, minNights }`: each night at its base, season or event price, `stayCents` their sum, `nightlyCents` their average (rounded to the centime); the lines always sum to the total · `422 MIN_NIGHTS` below the stay's minimum (the listing's `minNights`, raised by a season or event covering one of its nights) |

## Account (signed in)

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/sign-up/email` · `sign-in/email` · `sign-out` | `{ name, email, password }` | Better Auth; sets the session cookie. For an account with double authentification, `sign-in/email` answers `{ twoFactorRedirect: true, twoFactorMethods: ["totp"] }` and sets no session until the code |
| `POST /api/auth/two-factor/verify-totp` · `verify-backup-code` | `{ code, trustDevice? }` | Second step of sign-in (or first code at enrollment); sets the session cookie · `401 INVALID_CODE` / `INVALID_BACKUP_CODE` · 5 attempts per challenge, account locked 15 min after 10 failures |
| `POST /api/auth/two-factor/enable` · `generate-backup-codes` · `disable` | `{ password }` | Enrollment: `{ totpURI, backupCodes }`; on only after the first `verify-totp` (Better Auth `twoFactor` plugin) |
| `GET /api/bookings` | | `{ bookings }`, latest stay first |
| `POST /api/bookings` | `{ listingId, checkIn, checkOut, adults, children?, infants?, pets? }` | `201` booking with a price snapshot · `409 UNAVAILABLE` · `422 INVALID_DATES / MIN_NIGHTS / TOO_MANY_GUESTS / PETS_NOT_ALLOWED / NOT_BOOKABLE` · `403 OWN_LISTING` |
| `POST /api/bookings/:id/cancel` | | Cancelled booking (record kept) · `409 NOT_CANCELLABLE` once started or already cancelled · `404` for other users' bookings |
| `GET /api/wishlist` | | `{ ids }`, most recent first |
| `POST /api/wishlist` | `{ ids }` | Merges favourites saved while signed out; returns `{ ids }` |
| `PUT` / `DELETE /api/wishlist/:listingId` | | `204`, idempotent |
| `POST /api/listings/:id/reviews` | `{ rating: 1–5, body }` | `201` · `403 NO_STAY` without a completed stay · `409 ALREADY_REVIEWED` (one per stay) |

## Back-office (team: ADMIN, AGENT)

Every route checks the session, the role (from the database, not the cookie), the organization and double authentification (`lib/server/authz.ts`): `401 UNAUTHENTICATED` without a session, `403 FORBIDDEN` for guests, owners or a role the section doesn't allow, `403 TWO_FACTOR_REQUIRED` for staff who haven't turned double authentification on. Data is always the caller's organization.

| Method & path | Roles | Returns |
|---|---|---|
| `GET /api/admin/dashboard` | ADMIN, AGENT | `{ listings, upcomingBookings, licensesExpiring, licensesPending }`: homes, confirmed guest stays arriving today or later (owner blocks excluded), loi 80-14 authorisations expired or expiring within 60 days, homes without an authorisation number · `Cache-Control: private, no-store` |

Biens (`/admin/biens`, ADMIN only) uses server actions, not JSON routes (`app/admin/biens/actions.ts`): `createListingAction`, `updateListingAction`, `uploadPhotoAction`, `movePhotoAction` (`cover`, `up`, `down`), `deletePhotoAction`. Each checks access again (`requireAdminAction("/admin/biens")`) and answers `{ error }` when refused; a listing or photo id of another organization is "Bien introuvable." / "Photo introuvable.", as an unknown one. Validation (`lib/admin/listing-form.ts`, zod): amounts typed in dirhams and stored in centimes, commission typed in percent and stored in basis points, required for a mandate (MANAGED) and always 0 for a sub-let (SUBLEASE, database check `listings_sublease_commission_check`), the 80-14 number and expiry date given together, the owner an OWNER of the same organization. A listing is created as a draft; publishing needs at least one photo, and a published listing keeps one.

Utilisateurs (`/admin/utilisateurs`, ADMIN only) also uses server actions (`app/admin/utilisateurs/actions.ts`), each guarded by `requireAdminAction("/admin/utilisateurs")` and answering `{ error }` when refused; a user or invitation id of another organization is "Utilisateur introuvable." / "Invitation introuvable.": `inviteUserAction` (e-mail, role OWNER/AGENT/ADMIN, optional phone → `{ issued: { link, whatsapp, expires, delivered } }`, the link shown once), `resendInvitationAction`, `revokeInvitationAction`, `changeRoleAction` (409 rules: last active ADMIN, owner with listings), `resetTwoFactorAction` (acting admin's password + `confirm`), `setUserActiveAction` (deactivate needs `confirm`). The public page `/invitation/<token>` uses `acceptWithNewAccountAction` (name, password) and `acceptWithExistingAccountAction` (signed in with the invited e-mail), in `app/invitation/[token]/actions.ts`. A deactivated account's sign-in answers `403 ACCOUNT_DEACTIVATED`.

Prix (`/admin/prix`, ADMIN only) uses server actions (`app/admin/prix/actions.ts`), each guarded by `requireAdminAction("/admin/prix")` and answering `{ error }` when refused: `createRuleAction` and `updateRuleAction(id)` (`kind` SEASON/EVENT, `name`, `startDate`, `endDate` = first and last night, `recurring`, `adjustmentType` PERCENT with `percent` (signed, e.g. `+20`, `-10`) or FIXED with `fixed` in dirhams, optional `minNights` and `priority`, `scope` ALL or SELECTED with `listingIds`), redirecting to `/admin/prix?cree=<id>` / `?modifie=<id>`; `deleteRuleAction(id)` (`confirm`). A rule or listing of another organization is "Règle introuvable." / "Bien introuvable.". Validation: `lib/admin/price-rule-form.ts`, database checks in migration `20261024090000_price_rules`; every write is audited (`price_rule.created`, `.updated` with from/to, `.deleted`).

Réservations (`app/admin/reservations/actions.ts`) uses server actions guarded by `requireAdminAction(BOOKING_ENTRY_PATH)` (ADMIN only; agents read the calendar and lists, without amounts): `createEntryAction(kind)` with `kind` = `directe` (listing, dates, guest counts, guest name + phone or e-mail, `channel` PHONE/WHATSAPP/EMAIL/IN_PERSON/OTHER, optional `nightly`/`cleaning` in dirhams, `allowShortStay`, `note`), `plateforme` (`source` AIRBNB/BOOKING/AGODA/TRIPCOM/EXPEDIA, `externalRef`, optional `total` and `cleaning`) or `blocage` (dates, `note` = reason), redirecting to `/admin/reservations/<id>?cree=<kind>`; `rescheduleBookingAction` (`checkIn`, `checkOut`, `allowShortStay`); `cancelBookingAction` (`confirm`). Refusals come back as `{ error }`: overlaps name the booking in the way ("Ces dates chevauchent un blocage propriétaire du … au …"), a duplicate platform code, the minimum stay, the capacity; a listing or booking of another organization is "Bien introuvable." / "Réservation introuvable.". Rules: README « Bookings in the back-office ».

| Method & path | Who | Returns |
|---|---|---|
| `GET /media/<key>` | anyone for a published listing's photo; staff (ADMIN, AGENT with 2FA) of the listing's organization for a draft's | The uploaded file (`Cache-Control: public, max-age=86400` or `private, no-store`) · `404` for anything else, including keys that don't belong to a photo |

## Booking rules

- Stays start today or later (today = the listing's local date, from `Place.timezone`), at most 365 days ahead, and last 1–60 nights; cancellation closes on the listing's local arrival day.
- `adults + children ≤ maxGuests`; at least one adult; pets need the "Animaux acceptés" amenity.
- Price is computed on the server by the pricing engine (`lib/pricing/engine.ts`): Σ of the nights' prices (base price, or the season's or event's) + cleaning, stored on the booking with `nightlyCents` = the average of the nights and `totalCents` exact (`serviceFeeCents` stays in the response and is 0: Sigma charges guests no service fee).
- Minimum stay: the listing's `minNights`, raised by any season or event of the listing covering one of the stay's nights; the search applies the same rule.
- **No double booking**: checked in the transaction, and guaranteed by the Postgres exclusion constraint `bookings_no_overlap` (GiST on listing + `daterange`, confirmed stays only). Concurrent requests for the same dates: exactly one succeeds (see `tests/integration/bookings.test.ts`).
- Guests cancel their own confirmed stays until the day before arrival; cancelled dates become bookable again.
