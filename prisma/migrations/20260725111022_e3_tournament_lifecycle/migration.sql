-- E3 — Tournament lifecycle, seeding, bracket generation and advancement.
--
-- `OpsEvent.updatedAt` is added WITH a default so the migration is safe against a
-- non-empty table (Prisma's generated form would have failed on any existing
-- row). Prisma's @updatedAt still drives the value on every subsequent write.

-- CreateEnum
CREATE TYPE "MatchSlot" AS ENUM ('A', 'B');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TournamentStatus" ADD VALUE 'PUBLISHED';
ALTER TYPE "TournamentStatus" ADD VALUE 'BRACKET_GENERATED';

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "loserId" TEXT,
ADD COLUMN     "loserNextMatchId" TEXT,
ADD COLUMN     "loserNextMatchSlot" "MatchSlot",
ADD COLUMN     "nextMatchSlot" "MatchSlot",
ADD COLUMN     "seedA" INTEGER,
ADD COLUMN     "seedB" INTEGER,
ADD COLUMN     "tieUnresolved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OpsEvent" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "error" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "bracketGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currentStage" "RoundStage",
ADD COLUMN     "maxRegistrations" INTEGER,
ADD COLUMN     "minRegistrations" INTEGER,
ADD COLUMN     "seededAt" TIMESTAMP(3),
ADD COLUMN     "thirdPlaceEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Match_tournamentId_status_idx" ON "Match"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "OpsEvent_tournamentId_status_idx" ON "OpsEvent"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "OpsEvent_status_scheduledFor_idx" ON "OpsEvent"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_loserNextMatchId_fkey" FOREIGN KEY ("loserNextMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpsEvent" ADD CONSTRAINT "OpsEvent_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
