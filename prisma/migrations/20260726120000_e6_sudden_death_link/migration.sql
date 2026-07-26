-- E6 — sudden death (D5.6 / D14).
--
-- A SUDDEN_DEATH match points back at the deadlocked match it exists to settle.
-- One-to-one: a match has at most one sudden-death decider, and a decider
-- settles exactly one match — hence the UNIQUE index rather than a plain FK.
--
-- Keeping the link on the sudden-death row (rather than a pointer on the
-- original) means the main bracket topology is untouched: advancement still
-- reads nextMatchId/loserNextMatchId exactly as before, and never has to know
-- that sudden death happened.

-- AlterTable
ALTER TABLE "Match" ADD COLUMN "resolvesMatchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Match_resolvesMatchId_key" ON "Match"("resolvesMatchId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_resolvesMatchId_fkey" FOREIGN KEY ("resolvesMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
