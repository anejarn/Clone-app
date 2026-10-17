-- Sigma manages homes in Marrakech: new places default to Morocco's time zone.
-- Existing rows keep their value (the seed sets every place explicitly).
ALTER TABLE "places" ALTER COLUMN "timezone" SET DEFAULT 'Africa/Casablanca';
