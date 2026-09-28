-- The password is now the ADMIN_PASSWORD environment variable; nothing about
-- it is stored in the database.
ALTER TABLE "User" DROP COLUMN "passwordChangedAt",
DROP COLUMN "passwordHash";

-- Name used in the greeting (editable in Settings).
UPDATE "User" SET "displayName" = 'Shahriar Ahmed' WHERE btrim("displayName") = '';

-- Sessions are bound to the password they were created with. Existing
-- sessions can't be bound retroactively, so everyone signs in once more.
DELETE FROM "Session";

ALTER TABLE "Session" ADD COLUMN     "credential" CHAR(64) NOT NULL,
ADD COLUMN     "failedUnlocks" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_credential_check" CHECK ("credential" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Session_failedUnlocks_check" CHECK ("failedUnlocks" BETWEEN 0 AND 5);

-- Time of day ("HH:MM", 24-hour), e.g. from a bank SMS. Optional.
ALTER TABLE "Transaction" ADD COLUMN     "time" CHAR(5);

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_time_check" CHECK ("time" IS NULL OR "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
