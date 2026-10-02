-- An SMS balance replaces the account's balance. The newest message for an
-- account sets it as of the moment the message is read: whatever was already
-- recorded is taken as included, so the account shows exactly what the bank or
-- wallet said. When the message was sent is kept for display and for telling
-- which message is the newest.

ALTER TABLE "BalanceCheckpoint"
  ADD COLUMN "messageDate" DATE,
  ADD COLUMN "messageTime" CHAR(5);

-- Until now an SMS balance sat at the message's own moment.
UPDATE "BalanceCheckpoint" SET "messageDate" = "date", "messageTime" = "time" WHERE "source" = 'SMS';

ALTER TABLE "BalanceCheckpoint"
  ADD CONSTRAINT "BalanceCheckpoint_message_check" CHECK (
    ("source" = 'SMS' AND "messageDate" IS NOT NULL) OR
    ("source" = 'MANUAL' AND "messageDate" IS NULL AND "messageTime" IS NULL)
  ),
  ADD CONSTRAINT "BalanceCheckpoint_messageTime_check" CHECK (
    "messageTime" IS NULL OR "messageTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

-- Each account's newest SMS balance becomes its current balance now (in the
-- owner's timezone), unless a balance you entered is for a later moment.
WITH clock AS (
  SELECT now() AT TIME ZONE COALESCE((SELECT "timezone" FROM "User" LIMIT 1), 'Asia/Dhaka') AS "at"
),
newest AS (
  SELECT DISTINCT ON (c."accountId")
         c."id", c."accountId", c."messageDate", COALESCE(c."messageTime", '24:00')::text AS "messageAt"
  FROM "BalanceCheckpoint" c
  WHERE c."source" = 'SMS'
  ORDER BY c."accountId", c."messageDate" DESC, COALESCE(c."messageTime", '24:00')::text COLLATE "C" DESC, c."createdAt" DESC
)
UPDATE "BalanceCheckpoint" b
SET "date" = (SELECT "at" FROM clock)::date,
    "time" = NULL,
    "loggedTime" = to_char((SELECT "at" FROM clock), 'HH24:MI:SS')
FROM newest n
WHERE b."id" = n."id"
  AND n."messageDate" <= (SELECT "at" FROM clock)::date
  AND NOT EXISTS (
    SELECT 1 FROM "BalanceCheckpoint" m
    WHERE m."accountId" = n."accountId" AND m."source" = 'MANUAL'
      AND (m."date" > n."messageDate" OR (
        m."date" = n."messageDate" AND COALESCE(m."time", m."loggedTime", '24:00')::text COLLATE "C" > n."messageAt" COLLATE "C"
      ))
  );
