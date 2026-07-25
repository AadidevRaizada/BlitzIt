-- E5 — admin platform: operator-facing description, public listing visibility, and
-- archiving. Archiving is a filing flag, NOT a lifecycle state: putting it on
-- the E3 state machine would require a new terminal state plus edges from every
-- other one, for an operation that has nothing to do with how a tournament is
-- played.

-- CreateEnum
CREATE TYPE "TournamentVisibility" AS ENUM ('PUBLIC', 'UNLISTED');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "visibility" "TournamentVisibility" NOT NULL DEFAULT 'PUBLIC';
