-- E4 — Submission system & evaluation pipeline.
--
-- `Submission.category` is a REQUIRED column added to a table that may already
-- hold rows, so it is added nullable, backfilled from the joined Problem (which
-- is exactly where the value comes from at submit time), and only then made NOT
-- NULL. Prisma's generated form was a bare `ADD COLUMN ... NOT NULL`, which
-- fails on any non-empty table.

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "llmProvider" TEXT;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "category" "ChallengeCategory",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill the category of every existing submission from its problem.
UPDATE "Submission" AS s
SET "category" = p."category"
FROM "Problem" AS p
WHERE p."id" = s."problemId" AND s."category" IS NULL;

ALTER TABLE "Submission" ALTER COLUMN "category" SET NOT NULL;

-- CreateTable
CREATE TABLE "SubmissionRevision" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "deploymentUrl" TEXT NOT NULL,
    "commitSha" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionRevision_submissionId_idx" ON "SubmissionRevision"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionRevision_submissionId_version_key" ON "SubmissionRevision"("submissionId", "version");

-- CreateIndex
CREATE INDEX "Submission_userId_tournamentId_idx" ON "Submission"("userId", "tournamentId");

-- AddForeignKey
ALTER TABLE "SubmissionRevision" ADD CONSTRAINT "SubmissionRevision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
