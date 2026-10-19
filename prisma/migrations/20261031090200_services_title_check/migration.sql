-- Lot 4b: services_fields_check read the French title with jsonb_typeof("title" -> 'fr'), which is NULL when the title
-- has no French text — and a CHECK whose result is NULL passes, so a service without a French title was accepted.
-- Replaced by the same rule, NULL-safe (COALESCE … false). No row can be affected (the table is new and the app
-- always writes a French title).
ALTER TABLE "services" DROP CONSTRAINT "services_fields_check";
ALTER TABLE "services" ADD CONSTRAINT "services_fields_check" CHECK (
  "leadTimeHours" BETWEEN 0 AND 720
  AND jsonb_typeof("title") = 'object'
  AND COALESCE(jsonb_typeof("title" -> 'fr') = 'string' AND char_length(btrim("title" ->> 'fr')) BETWEEN 1 AND 120, false)
  AND jsonb_typeof("description") = 'object'
  AND jsonb_typeof("availability") = 'object'
  AND jsonb_typeof("options") = 'array'
  AND jsonb_array_length("options") <= 10
  AND ("photoKey" IS NULL OR "photoKey" LIKE 'services/%')
);
