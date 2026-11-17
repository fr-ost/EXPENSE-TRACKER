-- Automatic SMS import from the Android app.
--
-- "Device": a phone that hands its bank and wallet SMS to an account. It
-- holds a token (stored hashed) that lets it hand messages in and nothing
-- else. "SmsInbox": the messages that couldn't be added on their own and wait
-- for the user. Both go with the user, like sessions: they are not ledger
-- data, so a restore leaves them alone.

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "pendingUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "appVersion" VARCHAR(20),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsInbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "fingerprint" CHAR(40) NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "sender" VARCHAR(40) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsInbox_userId_fingerprint_key" ON "SmsInbox"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "SmsInbox_userId_receivedAt_idx" ON "SmsInbox"("userId", "receivedAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInbox" ADD CONSTRAINT "SmsInbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsInbox" ADD CONSTRAINT "SmsInbox_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
