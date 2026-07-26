ALTER TABLE "Registration" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

CREATE INDEX "Registration_tournamentId_status_holdExpiresAt_idx"
  ON "Registration"("tournamentId", "status", "holdExpiresAt");
