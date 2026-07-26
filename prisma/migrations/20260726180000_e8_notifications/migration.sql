-- E8 — spectator surfaces, notifications and the Hall of Fame.
--
-- Additive only. Nothing existing is altered or dropped, so an E7 deployment
-- keeps working against this schema unchanged.

-- 1. The email delivery job (E8.3). The queue is the only path from a
--    notification intent to an actual send, exactly as evaluation goes
--    Submission -> Queue -> Runner -> Engine (D3).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SEND_EMAIL';

-- 2. Notification types the tournament lifecycle actually raises. The enum
--    already carries REGISTRATION_CONFIRMED, SEEDED, ROUND_OPEN,
--    MATCH_REMINDER, RESULT, ELIMINATED, PAYOUT_SENT and PRIZE_POOL_UPDATE;
--    these two complete the set the bracket can produce.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ADVANCED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TOURNAMENT_COMPLETE';

-- 3. Notification bookkeeping.
--    `readAt` is distinct from `status = READ`: the in-app list needs to sort
--    and filter by WHEN something was read, and a status enum cannot answer
--    that. `attempts`/`lastError` mirror the job table so a failed send can be
--    explained without joining to it.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "tournamentId" TEXT;

-- The in-app list is always "my notifications, newest first".
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification" ("userId", "createdAt" DESC);

-- 4. Hall of Fame: record the third place alongside the champion and runner-up
--    so a completed tournament's podium is readable from one row (D12 pays
--    both semi-finalists, and THIRD_PLACE is a real stage when enabled).
ALTER TABLE "HallOfFame" ADD COLUMN IF NOT EXISTS "thirdPlaceId" TEXT;
ALTER TABLE "HallOfFame" ADD COLUMN IF NOT EXISTS "participantCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HallOfFame" ADD COLUMN IF NOT EXISTS "prizePoolMinor" INTEGER NOT NULL DEFAULT 0;
