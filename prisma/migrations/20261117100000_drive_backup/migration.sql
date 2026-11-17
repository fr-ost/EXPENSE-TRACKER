-- Backups in the user's own Google Drive.
--
-- One row per user who has connected Drive: Google's permission to write to
-- the app's hidden folder there (and nothing else), and when a backup last
-- reached it.

-- CreateTable
CREATE TABLE "DriveBackup" (
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBackupAt" TIMESTAMP(3),
    "lastBackupHash" CHAR(64),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" VARCHAR(200),

    CONSTRAINT "DriveBackup_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "DriveBackup" ADD CONSTRAINT "DriveBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
