-- Lot 4b, conciergerie: the organization's partners (car rental, guides, chefs, hammams…), its catalogue of services
-- (localized texts, sale and partner prices in centimes of dirham, options, lead time, one photo) and the guests'
-- requests from the welcome guide, with a price snapshot taken when asked, a status and the payment on the spot.
-- New tables only: nothing existing is rewritten or dropped.
-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('CAR', 'ACTIVITY', 'TRANSFER', 'CHEF', 'HAMMAM', 'CLEANING', 'GROCERIES', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "ServicePricingModel" AS ENUM ('PER_UNIT', 'PER_PERSON', 'PER_DAY', 'PER_TRIP', 'ON_QUOTE');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('NEW', 'SENT_TO_PARTNER', 'CONFIRMED', 'DONE', 'CANCELLED', 'REFUSED');

-- CreateEnum
CREATE TYPE "ServicePaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ServiceCategory" NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "preferredChannel" "PartnerChannel" NOT NULL DEFAULT 'WHATSAPP',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "availability" JSONB NOT NULL DEFAULT '{}',
    "pricingModel" "ServicePricingModel" NOT NULL,
    "salePriceCents" INTEGER,
    "partnerPriceCents" INTEGER,
    "options" JSONB NOT NULL DEFAULT '[]',
    "leadTimeHours" INTEGER NOT NULL DEFAULT 24,
    "photoKey" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'NEW',
    "serviceDate" DATE NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "persons" INTEGER NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "pricingModel" "ServicePricingModel" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "unitSaleCents" INTEGER,
    "unitPartnerCents" INTEGER,
    "saleTotalCents" INTEGER,
    "partnerTotalCents" INTEGER,
    "marginCents" INTEGER,
    "priceAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "guestNote" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL,
    "guestLocale" TEXT NOT NULL,
    "internalNote" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "sentVia" "PartnerChannel",
    "confirmedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "paymentMethod" "ServicePaymentMethod",
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partners_organizationId_active_idx" ON "partners"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "partners_id_organizationId_key" ON "partners"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "services_photoKey_key" ON "services"("photoKey");

-- CreateIndex
CREATE INDEX "services_organizationId_active_category_idx" ON "services"("organizationId", "active", "category");

-- CreateIndex
CREATE INDEX "services_partnerId_idx" ON "services"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "services_id_organizationId_key" ON "services"("id", "organizationId");

-- CreateIndex
CREATE INDEX "service_requests_organizationId_status_createdAt_idx" ON "service_requests"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "service_requests_organizationId_serviceDate_idx" ON "service_requests"("organizationId", "serviceDate");

-- CreateIndex
CREATE INDEX "service_requests_bookingId_idx" ON "service_requests"("bookingId");

-- CreateIndex
CREATE INDEX "service_requests_serviceId_idx" ON "service_requests"("serviceId");

-- CreateIndex
CREATE INDEX "service_requests_partnerId_idx" ON "service_requests"("partnerId");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_partnerId_organizationId_fkey" FOREIGN KEY ("partnerId", "organizationId") REFERENCES "partners"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_bookingId_organizationId_fkey" FOREIGN KEY ("bookingId", "organizationId") REFERENCES "bookings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_serviceId_organizationId_fkey" FOREIGN KEY ("serviceId", "organizationId") REFERENCES "services"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_partnerId_organizationId_fkey" FOREIGN KEY ("partnerId", "organizationId") REFERENCES "partners"("id", "organizationId") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ---------- Checks ----------

-- A partner: a name, at least one contact, and the contact of its preferred channel.
ALTER TABLE "partners" ADD CONSTRAINT "partners_contact_check" CHECK (
  char_length(btrim("name")) BETWEEN 1 AND 120
  AND char_length("notes") <= 2000
  AND ("phone" IS NULL OR char_length("phone") BETWEEN 6 AND 40)
  AND ("whatsapp" IS NULL OR char_length("whatsapp") BETWEEN 6 AND 40)
  AND ("email" IS NULL OR (char_length("email") <= 200 AND "email" LIKE '%_@_%'))
  AND COALESCE("phone", "whatsapp", "email") IS NOT NULL
  AND CASE "preferredChannel"
        WHEN 'WHATSAPP' THEN "whatsapp" IS NOT NULL
        WHEN 'EMAIL' THEN "email" IS NOT NULL
        ELSE "phone" IS NOT NULL
      END
);

-- A service's prices: none for ON_QUOTE, both otherwise, never negative, the margin never negative, at most 1 000 000 MAD.
ALTER TABLE "services" ADD CONSTRAINT "services_price_check" CHECK (
  ("pricingModel" = 'ON_QUOTE' AND "salePriceCents" IS NULL AND "partnerPriceCents" IS NULL)
  OR ("pricingModel" <> 'ON_QUOTE' AND "salePriceCents" IS NOT NULL AND "partnerPriceCents" IS NOT NULL
      AND "partnerPriceCents" >= 0 AND "salePriceCents" >= "partnerPriceCents" AND "salePriceCents" <= 100000000)
);
ALTER TABLE "services" ADD CONSTRAINT "services_fields_check" CHECK (
  "leadTimeHours" BETWEEN 0 AND 720
  AND jsonb_typeof("title") = 'object'
  AND jsonb_typeof("title" -> 'fr') = 'string'
  AND char_length(btrim("title" ->> 'fr')) BETWEEN 1 AND 120
  AND jsonb_typeof("description") = 'object'
  AND jsonb_typeof("availability") = 'object'
  AND jsonb_typeof("options") = 'array'
  AND jsonb_array_length("options") <= 10
  AND ("photoKey" IS NULL OR "photoKey" LIKE 'services/%')
);

-- A request's fields and its price snapshot: unit prices for every model but ON_QUOTE, totals all set or all null
-- (quote pending), margin = sale - partner, never negative.
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_fields_check" CHECK (
  "quantity" BETWEEN 1 AND 50
  AND "persons" BETWEEN 1 AND 50
  AND "startMinutes" BETWEEN 0 AND 1439
  AND "guestLocale" ~ '^[a-z]{2,3}$'
  AND char_length("guestNote") <= 1000
  AND char_length("internalNote") <= 2000
  AND char_length(btrim("contactPhone")) BETWEEN 6 AND 40
  AND char_length(btrim("titleSnapshot")) BETWEEN 1 AND 120
  AND jsonb_typeof("options") = 'array'
);
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_price_check" CHECK (
  (("unitSaleCents" IS NULL AND "unitPartnerCents" IS NULL)
    OR ("unitSaleCents" IS NOT NULL AND "unitPartnerCents" IS NOT NULL AND "unitPartnerCents" >= 0 AND "unitSaleCents" >= "unitPartnerCents"))
  AND ("pricingModel" = 'ON_QUOTE' OR "unitSaleCents" IS NOT NULL)
  AND (("saleTotalCents" IS NULL AND "partnerTotalCents" IS NULL AND "marginCents" IS NULL)
    OR ("saleTotalCents" IS NOT NULL AND "partnerTotalCents" IS NOT NULL AND "marginCents" IS NOT NULL
        AND "partnerTotalCents" >= 0 AND "saleTotalCents" >= "partnerTotalCents" AND "saleTotalCents" <= 1000000000
        AND "marginCents" = "saleTotalCents" - "partnerTotalCents"))
);

-- Status timestamps follow the status; a confirmed or done request has its price; a paid one is confirmed or done.
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_status_check" CHECK (
  (("sentAt" IS NULL) = ("sentVia" IS NULL))
  AND CASE "status"
    WHEN 'NEW' THEN "sentAt" IS NULL AND "confirmedAt" IS NULL AND "doneAt" IS NULL AND "cancelledAt" IS NULL AND "refusedAt" IS NULL
    WHEN 'SENT_TO_PARTNER' THEN "sentAt" IS NOT NULL AND "confirmedAt" IS NULL AND "doneAt" IS NULL AND "cancelledAt" IS NULL AND "refusedAt" IS NULL
    WHEN 'CONFIRMED' THEN "sentAt" IS NOT NULL AND "confirmedAt" >= "sentAt" AND "doneAt" IS NULL AND "cancelledAt" IS NULL AND "refusedAt" IS NULL
      AND "saleTotalCents" IS NOT NULL
    WHEN 'DONE' THEN "sentAt" IS NOT NULL AND "confirmedAt" >= "sentAt" AND "doneAt" >= "confirmedAt" AND "cancelledAt" IS NULL AND "refusedAt" IS NULL
      AND "saleTotalCents" IS NOT NULL
    WHEN 'CANCELLED' THEN "cancelledAt" IS NOT NULL AND "doneAt" IS NULL AND "refusedAt" IS NULL
    WHEN 'REFUSED' THEN "refusedAt" IS NOT NULL AND "confirmedAt" IS NULL AND "doneAt" IS NULL AND "cancelledAt" IS NULL
  END
);
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_payment_check" CHECK (
  (("paymentMethod" IS NULL) = ("paidAt" IS NULL))
  AND ("paidAt" IS NULL OR ("status" IN ('CONFIRMED', 'DONE') AND "saleTotalCents" IS NOT NULL))
);

-- Owner blocks have no guest, hence no request.
CREATE FUNCTION "service_requests_booking_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "bookings" WHERE "id" = NEW."bookingId" AND "source" <> 'OWNER';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service_requests_booking_check: an owner block has no service request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "service_requests_booking_check" BEFORE INSERT OR UPDATE OF "bookingId" ON "service_requests"
FOR EACH ROW EXECUTE FUNCTION "service_requests_booking_check"();
