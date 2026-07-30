-- Internal testing environment: the TEST role, TournamentEnvironment, and bots.
--
-- Additive only. Every existing row keeps the behaviour it had:
--   * every existing Tournament becomes PRODUCTION (the column default);
--   * every existing User keeps isBot = false;
--   * the Role enum gains a value nobody holds yet.
--
-- The new enum value is added but NOT used in this migration, which is what
-- makes it safe inside Prisma's transaction (Postgres forbids using a value
-- added to an enum in the same transaction that added it).

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TEST';

-- Which world a tournament belongs to. Orthogonal to "status" (lifecycle phase)
-- and "visibility" (listed or not) — see the schema comment for why UNLISTED
-- was not reused for this.
CREATE TYPE "TournamentEnvironment" AS ENUM ('PRODUCTION', 'TEST');

ALTER TABLE "Tournament"
  ADD COLUMN "environment" "TournamentEnvironment" NOT NULL DEFAULT 'PRODUCTION';

-- Public discovery filters on (environment, status) together on every surface.
CREATE INDEX "Tournament_environment_status_idx"
  ON "Tournament" ("environment", "status");

-- A bot is a real User row (see the schema comment). The flag is what every
-- query filters on; the configuration lives in BotProfile.
ALTER TABLE "User"
  ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "User_isBot_idx" ON "User" ("isBot");

CREATE TYPE "BotSubmitBehaviour" AS ENUM ('ALWAYS', 'NEVER', 'LATE');
CREATE TYPE "BotScoreMode" AS ENUM ('SEEDED', 'FIXED', 'TIE');

CREATE TABLE "BotProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "skill" INTEGER NOT NULL DEFAULT 50,
  "submitBehaviour" "BotSubmitBehaviour" NOT NULL DEFAULT 'ALWAYS',
  "scoreMode" "BotScoreMode" NOT NULL DEFAULT 'SEEDED',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BotProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotProfile_userId_key" ON "BotProfile" ("userId");

-- Cascade: deleting a bot deletes its configuration. Bots are the one identity
-- on this platform that IS hard-deletable, because they have no competitive
-- record worth preserving.
ALTER TABLE "BotProfile"
  ADD CONSTRAINT "BotProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
