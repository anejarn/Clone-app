-- Lot 4b: service_requests_status_check compared timestamps that could be NULL ("confirmedAt" >= "sentAt"), and a
-- CHECK whose result is NULL passes: a confirmed request without its confirmation time would have been accepted.
-- Replaced by the same rule with every timestamp it compares required explicitly. No row can be affected (the table
-- is new and only the app writes it).
ALTER TABLE "service_requests" DROP CONSTRAINT "service_requests_status_check";
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_status_check" CHECK (
  (("sentAt" IS NULL) = ("sentVia" IS NULL))
  AND CASE "status"
    WHEN 'NEW' THEN "sentAt" IS NULL AND "confirmedAt" IS NULL AND "doneAt" IS NULL AND "cancelledAt" IS NULL AND "refusedAt" IS NULL
    WHEN 'SENT_TO_PARTNER' THEN "sentAt" IS NOT NULL AND "confirmedAt" IS NULL AND "doneAt" IS NULL AND "cancelledAt" IS NULL AND "refusedAt" IS NULL
    WHEN 'CONFIRMED' THEN "sentAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "confirmedAt" >= "sentAt"
      AND "doneAt" IS NULL AND "cancelledAt" IS NULL AND "refusedAt" IS NULL AND "saleTotalCents" IS NOT NULL
    WHEN 'DONE' THEN "sentAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "doneAt" IS NOT NULL
      AND "confirmedAt" >= "sentAt" AND "doneAt" >= "confirmedAt"
      AND "cancelledAt" IS NULL AND "refusedAt" IS NULL AND "saleTotalCents" IS NOT NULL
    WHEN 'CANCELLED' THEN "cancelledAt" IS NOT NULL AND "doneAt" IS NULL AND "refusedAt" IS NULL
    WHEN 'REFUSED' THEN "refusedAt" IS NOT NULL AND "confirmedAt" IS NULL AND "doneAt" IS NULL AND "cancelledAt" IS NULL
    ELSE false
  END
);
