-- E9.2 - dynamic prize pools and paid-but-superseded payment metadata.
--
-- Additive only. Existing tournaments keep their current stored pool until the
-- E9 recompute path touches them or an operator backfills them.

ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "sponsorContributionMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "bonusContributionMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "supersededByPaymentId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundRequiredAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundReason" TEXT;

CREATE INDEX IF NOT EXISTS "Payment_tournamentId_refundRequiredAt_idx"
  ON "Payment" ("tournamentId", "refundRequiredAt");
