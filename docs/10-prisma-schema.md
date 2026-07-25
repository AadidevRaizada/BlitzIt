# 10 — Final Prisma Schema (implementation-ready)

> This is the **spec** to copy into `prisma/schema.prisma` at implementation time (Milestone 0).
> It is documentation, not yet wired into the app. Prisma **7** — connection config lives in
> `prisma.config.ts`, not here. Better Auth generates its own tables (`user/session/account/
> verification`); the domain `User` below links to the Better Auth user via `authUserId`.

## `prisma.config.ts` (Prisma 7 — reference)

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') }, // NOT in schema.prisma in v7
});
```

## `schema.prisma`

```prisma
generator client {
  provider = "prisma-client"          // v7: not "prisma-client-js"
  output   = "../src/generated/prisma" // v7: explicit; gitignored, generated in CI
}

datasource db {
  provider = "postgresql"             // v7: no url here — see prisma.config.ts
}

/// ─────────────────────────── Enums ───────────────────────────
enum Role            { USER ADMIN }
enum TournamentStatus{ DRAFT REGISTRATION_OPEN REGISTRATION_CLOSED SIMULATION SEEDING LIVE COMPLETED CANCELLED }
enum RoundType       { SIMULATION KNOCKOUT }
enum RoundStage      { SIMULATION R64 R32 R16 QF SF THIRD_PLACE FINAL SUDDEN_DEATH }
enum RoundStatus     { PENDING OPEN JUDGING COMPLETED }
enum MatchStatus     { PENDING LIVE JUDGING DECIDED }
enum WinReason       { SCORE TIEBREAK_FUNCTIONAL TIEBREAK_TESTS TIEBREAK_TIME TIEBREAK_PERFORMANCE TIEBREAK_AI SUDDEN_DEATH BYE WALKOVER ADMIN }
enum ChallengeCategory { REST_API WEB_APP AI_AGENT OCR AUTOMATION INTERNAL_TOOL CLI_APP CHROME_EXTENSION }
enum ProblemVisibility { DRAFT PUBLISHED ARCHIVED }
enum SubmissionStatus{ RECEIVED QUEUED JUDGING SCORED FAILED DISQUALIFIED }
enum JobType         { EVALUATE REEVALUATE }
enum JobStatus       { QUEUED CLAIMED RUNNING DONE FAILED }
enum PaymentStatus   { CREATED PENDING PAID FAILED REFUNDED }
enum RegistrationStatus { ACTIVE REVOKED REFUNDED }
enum PayoutStatus    { PENDING KYC_REQUIRED PROCESSING PAID FAILED }
enum NotificationType{ REGISTRATION_CONFIRMED SEEDED ROUND_OPEN MATCH_REMINDER RESULT ELIMINATED PAYOUT_SENT PRIZE_POOL_UPDATE }
enum NotificationChannel { EMAIL IN_APP }
enum NotificationStatus  { PENDING SENT FAILED READ }

/// ─────────────────────────── Identity ───────────────────────────
model User {
  id           String   @id @default(uuid())
  authUserId   String   @unique                 // → Better Auth user.id
  email        String   @unique
  username     String   @unique
  displayName  String?
  avatarUrl    String?
  city         String?
  country      String?  @default("IN")
  role         Role     @default(USER)
  profile      Profile?
  registrations Registration[]
  payments     Payment[]
  submissions  Submission[]
  rankings     Ranking[]
  payouts      Payout[]
  notifications Notification[]
  userBadges   UserBadge[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([city])
}

model Profile {
  id               String   @id @default(uuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bio              String?
  githubUsername   String?
  websiteUrl       String?
  twitterHandle    String?
  preferredTimezone String? @default("Asia/Kolkata")
  stats            Json?     // cached lifetime wins/points
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

/// ─────────────────────────── Competition ───────────────────────────
model Tournament {
  id                 String @id @default(uuid())
  slug               String @unique
  name               String
  status             TournamentStatus @default(DRAFT)
  passPriceMinor     Int    @default(10000)      // ₹100
  currency           String @default("INR")
  bracketSize        Int?                          // 8 | 16 | 32 | 64 (set at seeding)
  timezoneDisplay    String @default("Asia/Kolkata")
  youtubeStreamUrl   String?
  // dynamic prize pool (D9)
  participantCount        Int @default(0)
  basePrizePoolMinor      Int @default(0)
  prizePerRegistrationMinor Int @default(0)
  firstPrizeCapMinor      Int @default(200000)   // ₹2,000 cap Week 1
  prizePoolMinor          Int @default(0)         // computed
  prizeDistribution       Json?                    // placement → share
  // schedule (all UTC)
  registrationOpensAt  DateTime?
  registrationClosesAt DateTime?
  simulationOpensAt    DateTime?
  simulationClosesAt   DateTime?
  liveStartsAt         DateTime?
  completedAt          DateTime?
  roundDurations       Json?   // e.g. {simulation:[1800,1200,600], knockout:[1200,1800,2400,3000,3600]}
  evaluationProfiles   Json?   // stage -> evaluation profile overrides (D20); null = defaults
  createdBy            String?
  rounds               Round[]
  matches              Match[]
  submissions          Submission[]
  registrations        Registration[]
  payments             Payment[]
  rankings             Ranking[]
  payouts              Payout[]
  evaluations          Evaluation[]
  hallOfFame           HallOfFame?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  @@index([status])
}

model Round {
  id            String @id @default(uuid())
  tournamentId  String
  tournament    Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  type          RoundType
  stage         RoundStage
  sequence      Int
  status        RoundStatus @default(PENDING)
  problemId     String?
  problem       Problem? @relation(fields: [problemId], references: [id])
  opensAt       DateTime?
  deadlineAt    DateTime?   // server-authoritative
  durationSeconds Int
  matches       Match[]
  submissions   Submission[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([tournamentId, stage, sequence])
}

model Match {
  id             String @id @default(uuid())
  roundId        String
  round          Round  @relation(fields: [roundId], references: [id], onDelete: Cascade)
  tournamentId   String
  tournament     Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  bracketPosition Int
  competitorAId  String?
  competitorBId  String?
  submissionAId  String? @unique
  submissionBId  String? @unique
  winnerId       String?
  winReason      WinReason?
  status         MatchStatus @default(PENDING)
  nextMatchId    String?
  nextMatch      Match?  @relation("Bracket", fields: [nextMatchId], references: [id])
  feederMatches  Match[] @relation("Bracket")
  decidedAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([roundId, bracketPosition])
  @@index([tournamentId])
}

model Problem {
  id                String @id @default(uuid())
  title             String
  slug              String @unique
  statementMarkdown String
  difficulty        String?
  category          ChallengeCategory
  evaluationStrategy String            // strategy key (resolves in code)
  contractSpec      Json               // category-specific config
  starterRepoUrl    String?
  visibility        ProblemVisibility @default(DRAFT)
  authorId          String?
  hiddenTests       HiddenTest[]
  rounds            Round[]
  submissions       Submission[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model HiddenTest {
  id         String @id @default(uuid())
  problemId  String
  problem    Problem @relation(fields: [problemId], references: [id], onDelete: Cascade)
  sequence   Int
  name       String
  kind       String   // HTTP_ASSERTION | SCRIPT | PROPERTY | OUTPUT_MATCH …
  spec       Json     // request + expected assertion
  weight     Int      @default(1)
  timeoutMs  Int      @default(10000)
  hidden     Boolean  @default(true)
  createdAt  DateTime @default(now())
  @@unique([problemId, sequence])
}

/// ─────────────────────────── Submissions & evaluation ───────────────────────────
model Submission {
  id            String @id @default(uuid())
  userId        String
  user          User   @relation(fields: [userId], references: [id])
  tournamentId  String
  tournament    Tournament @relation(fields: [tournamentId], references: [id])
  roundId       String
  round         Round  @relation(fields: [roundId], references: [id])
  matchId       String?
  problemId     String
  problem       Problem @relation(fields: [problemId], references: [id])
  repoUrl       String
  deploymentUrl String
  commitSha     String?
  submittedAt   DateTime @default(now())   // server time — anti-cheat anchor
  sealedAt      DateTime?
  status        SubmissionStatus @default(RECEIVED)
  evaluation    Evaluation?
  jobs          EvaluationJob[]
  createdAt     DateTime @default(now())
  @@unique([userId, roundId])
  @@index([tournamentId, status])
}

model Evaluation {
  id                     String @id @default(uuid())
  submissionId           String @unique
  submission             Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  tournamentId           String
  tournament             Tournament @relation(fields: [tournamentId], references: [id])
  attempt                Int    @default(1)
  functionalScore        Float  @default(0)   // 0–100
  testsPassed            Int    @default(0)
  testsTotal             Int    @default(0)
  testResults            Json?
  deploymentReachable    Boolean @default(false)
  performanceScore       Float  @default(0)
  securityReliabilityScore Float @default(0)
  aiScore                Float  @default(0)
  overallScore           Float  @default(0)   // weighted, ACTIVE dimensions only (D20)
  profileName            String?              // stage profile that governed this score
  dimensions             Json?                // which dimensions actually ran
  weights                Json                  // exact weights used (reproducibility)
  probeEvidence          Json?                 // latency/throughput/security probe results
  repoTextSnapshot       Json?                 // key files pulled via GitHub API (no cloning)
  rubricVersion          String?
  modelId                String?
  modelPromptHash        String?
  llmRaw                 Json?                 // full prompt+response for audit
  startedAt              DateTime?
  finishedAt             DateTime?
  error                  String?
  overriddenBy           String?
  overrideReason         String?
  createdAt              DateTime @default(now())
}

model EvaluationJob {
  id             String @id @default(uuid())
  submissionId   String
  submission     Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  type           JobType    @default(EVALUATE)
  status         JobStatus  @default(QUEUED)
  attempts       Int        @default(0)
  maxAttempts    Int        @default(3)
  priority       Int        @default(0)
  claimedAt      DateTime?
  lockedBy       String?
  availableAt    DateTime   @default(now())   // backoff
  lastError      String?
  idempotencyKey String     @unique            // eval:{submissionId}:{attempt}
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  @@index([status, availableAt])               // claim query support
}

/// ─────────────────────────── Ranking ───────────────────────────
model Ranking {
  id                String @id @default(uuid())
  tournamentId      String
  tournament        Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  userId            String
  user              User @relation(fields: [userId], references: [id])
  simulationScore   Float @default(0)
  seed              Int?
  qualified         Boolean @default(false)
  currentStage      RoundStage?
  eliminatedAtStage RoundStage?
  placement         Int?
  points            Int   @default(0)
  city              String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@unique([tournamentId, userId])
  @@index([tournamentId, simulationScore(sort: Desc)])
  @@index([tournamentId, city])
}

/// ─────────────────────────── Payments ───────────────────────────
model Payment {
  id                String @id @default(uuid())
  userId            String
  user              User @relation(fields: [userId], references: [id])
  tournamentId      String
  tournament        Tournament @relation(fields: [tournamentId], references: [id])
  provider          String @default("RAZORPAY")
  providerOrderId   String @unique
  providerPaymentId String? @unique
  amountMinor       Int
  currency          String @default("INR")
  status            PaymentStatus @default(CREATED)
  signatureVerified Boolean @default(false)
  webhookEventId    String? @unique            // idempotency
  paidAt            DateTime?
  refundedAt        DateTime?
  registration      Registration?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@index([userId, tournamentId])
}

model Registration {
  id           String @id @default(uuid())
  userId       String
  user         User @relation(fields: [userId], references: [id])
  tournamentId String
  tournament   Tournament @relation(fields: [tournamentId], references: [id])
  paymentId    String? @unique
  payment      Payment? @relation(fields: [paymentId], references: [id])
  status       RegistrationStatus @default(ACTIVE)
  registeredAt DateTime @default(now())
  @@unique([userId, tournamentId])
}

model Payout {
  id               String @id @default(uuid())
  userId           String
  user             User @relation(fields: [userId], references: [id])
  tournamentId     String
  tournament       Tournament @relation(fields: [tournamentId], references: [id])
  placement        Int
  amountMinor      Int
  currency         String @default("INR")
  provider         String @default("RAZORPAYX")
  providerPayoutId String? @unique
  status           PayoutStatus @default(PENDING)
  tdsMinor         Int @default(0)
  taxMeta          Json?
  approvedBy       String?
  processedAt      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@unique([tournamentId, userId])
}

/// ─────────────────────────── Engagement ───────────────────────────
model Notification {
  id        String @id @default(uuid())
  userId    String
  user      User @relation(fields: [userId], references: [id])
  type      NotificationType
  channel   NotificationChannel @default(EMAIL)
  payload   Json?
  dedupeKey String @unique
  status    NotificationStatus @default(PENDING)
  sentAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId, status])
}

model Badge {
  id          String @id @default(uuid())
  slug        String @unique
  name        String
  description String?
  iconUrl     String?
  criteria    Json?
  userBadges  UserBadge[]
  createdAt   DateTime @default(now())
}

model UserBadge {
  id           String @id @default(uuid())
  userId       String
  user         User @relation(fields: [userId], references: [id])
  badgeId      String
  badge        Badge @relation(fields: [badgeId], references: [id])
  tournamentId String?
  awardedAt    DateTime @default(now())
  @@unique([userId, badgeId, tournamentId])
}

model HallOfFame {
  id           String @id @default(uuid())
  tournamentId String @unique
  tournament   Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  championId   String
  runnerUpId   String?
  finalMatchId String?
  highlightsUrl String?
  publishedAt  DateTime @default(now())
}

/// ─────────────────────────── Admin & audit ───────────────────────────
model AuditLog {
  id            String @id @default(uuid())
  actorId       String?
  action        String
  entityType    String
  entityId      String
  before        Json?
  after         Json?
  ip            String?
  userAgent     String?
  correlationId String?
  createdAt     DateTime @default(now())
  @@index([entityType, entityId])
}

model OpsEvent {
  id             String @id @default(uuid())
  type           String   // OPEN_REGISTRATION | CLOSE_REGISTRATION | UNLOCK_SIMULATION | SEED | START_ROUND | PUBLISH_RESULTS | TRIGGER_PAYOUTS
  tournamentId   String
  scheduledFor   DateTime
  status         String   @default("SCHEDULED") // SCHEDULED | RUNNING | DONE | FAILED
  idempotencyKey String   @unique
  runBy          String?  // system | admin
  result         Json?
  createdAt      DateTime @default(now())
}
```

## Notes for the implementer
- **Money:** all `*Minor` fields are integer paise. Never floats for money.
- **Immutability:** `Submission` rows are treated as append-only; sealing sets `sealedAt`. Enforce
  "no edits after `deadlineAt`" in the service layer.
- **Job claim query:** `SELECT … FROM "EvaluationJob" WHERE status='QUEUED' AND "availableAt" <= now()
  ORDER BY priority DESC, "createdAt" FOR UPDATE SKIP LOCKED LIMIT n;`
- **Better Auth tables** are generated by its Prisma adapter — do not hand-model them; `User.authUserId`
  is the link.
- **Generated client** goes to `src/generated/prisma` (gitignored); run `prisma generate` in
  postinstall/CI.
- Add DB-level partial unique for "one PAID payment per (user,tournament)" via a migration
  (`CREATE UNIQUE INDEX … WHERE status='PAID'`) — Prisma can't express partial uniques in schema yet.
