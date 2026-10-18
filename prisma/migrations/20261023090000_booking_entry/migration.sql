-- Lot 2d: bookings typed by the team in the back-office (Réservations → Nouvelle saisie). Two optional columns; no
-- existing row is rewritten (both stay NULL).
-- - channel: how a DIRECT booking reached the team (phone, WhatsApp, e-mail, in person, other);
-- - note: the team's internal note, also the reason of an owner block. Never shown to guests.

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('PHONE', 'WHATSAPP', 'EMAIL', 'IN_PERSON', 'OTHER');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "channel" "BookingChannel",
ADD COLUMN     "note" TEXT;

-- Only a direct booking has a channel: platform bookings come from their platform, owner blocks from the owner.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channel_check" CHECK ("channel" IS NULL OR "source" = 'DIRECT');

-- A note is a short text, not a document store (the app limits it to 2 000 characters too).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_note_length_check" CHECK ("note" IS NULL OR char_length("note") <= 2000);
