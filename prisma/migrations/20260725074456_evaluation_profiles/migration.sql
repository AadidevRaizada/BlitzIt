-- AlterEnum
ALTER TYPE "RoundStage" ADD VALUE 'THIRD_PLACE';

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN     "dimensions" JSONB,
ADD COLUMN     "profileName" TEXT;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "evaluationProfiles" JSONB;
