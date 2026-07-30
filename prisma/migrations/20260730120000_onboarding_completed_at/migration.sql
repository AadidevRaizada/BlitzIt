-- Add the onboarding gate timestamp. Existing users who already satisfy the
-- old readiness criteria are backfilled so they are not forced through a new
-- first-run flow after deployment.
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

UPDATE "User" AS u
SET "onboardingCompletedAt" = NOW()
WHERE u."displayName" IS NOT NULL
  AND BTRIM(u."displayName") <> ''
  AND u."city" IS NOT NULL
  AND BTRIM(u."city") <> ''
  AND EXISTS (
    SELECT 1
    FROM "Profile" AS p
    WHERE p."userId" = u."id"
      AND p."githubUsername" IS NOT NULL
      AND BTRIM(p."githubUsername") <> ''
  )
  AND EXISTS (
    SELECT 1
    FROM "TermsAcceptance" AS ta
    WHERE ta."userId" = u."id"
      AND ta."version" = '2026-07-26'
  );

CREATE INDEX "User_onboardingCompletedAt_idx" ON "User"("onboardingCompletedAt");
