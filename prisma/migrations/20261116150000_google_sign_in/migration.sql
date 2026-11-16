-- Sign in with Google.
--
-- The password (the ADMIN_PASSWORD variable) is gone: a user is whoever
-- Google says they are. The app lock, which used to ask for that password,
-- asks for a PIN of the user's own instead.

-- Sessions were bound to the password. Everyone signs in once more, with
-- Google; the owner's existing data is taken over by the Google account
-- named by OWNER_EMAIL (see README).
DELETE FROM "Session";

-- Their CHECK constraints go with the columns.
ALTER TABLE "Session" DROP COLUMN "credential",
DROP COLUMN "failedUnlocks";

ALTER TABLE "User" ADD COLUMN     "email" VARCHAR(320),
ADD COLUMN     "googleSub" VARCHAR(255),
ADD COLUMN     "pinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinHash" VARCHAR(255),
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

ALTER TABLE "User"
  ADD CONSTRAINT "User_googleSub_check" CHECK ("googleSub" IS NULL OR length("googleSub") > 0),
  ADD CONSTRAINT "User_pinFailures_check" CHECK ("pinFailures" >= 0);
