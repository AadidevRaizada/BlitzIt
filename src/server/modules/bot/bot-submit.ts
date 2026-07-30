import 'server-only';
import { db } from '@/server/db';
import { submitSolution } from '@/server/modules/submission';
import { logger } from '@/lib/logger';

/**
 * Bot submissions (D35).
 *
 * A bot has to actually submit, or the round it is in can never be decided on
 * anything but a walkover. It does so through the ordinary `submitSolution`,
 * which means it passes the real window check, the real registration guard, the
 * real match-pairing check and the real deployment-URL reuse rule, appends a
 * real `SubmissionRevision`, and lands a real job on the evaluation queue.
 *
 * ## Why the URLs look real
 *
 * `validateDeploymentUrl` refuses `.invalid`, `.test` and `.local` hosts — a
 * deliberate anti-footgun for real competitors that a bot cannot argue with. So
 * a bot's URLs are syntactically ordinary instead. Nothing ever fetches them:
 * `evaluateProcessor` routes a bot to the internal reference evaluator, which
 * contacts nothing and stamps its evidence `internal-reference`. The URL is an
 * identifier here, not an address.
 *
 * The deployment URL carries the round id because `@@unique([roundId,
 * deploymentUrl])` (D19) is enforced by the database: one shared bot URL would
 * make the second bot in any round fail to submit.
 */

const BOT_REPO_OWNER = 'blitzit-bots';
const BOT_DEPLOYMENT_HOST = 'bots.blitzit-test.dev';

export function botRepoUrl(username: string): string {
  return `https://github.com/${BOT_REPO_OWNER}/${username}`;
}

export function botDeploymentUrl(botUserId: string, roundId: string): string {
  return `https://${botUserId}.${BOT_DEPLOYMENT_HOST}/${roundId}`;
}

export interface BotSubmissionResult {
  submitted: number;
  skipped: number;
}

/**
 * Make every bot in a round submit, if it is going to.
 *
 * Idempotent: `submitSolution` replaces an existing entry rather than creating a
 * second one, but a bot's content never changes, so a re-run is a no-op in
 * substance. Bots that have already submitted are filtered out first so a replay
 * does not churn revision history.
 *
 * `submittedAt` is pinned to the round's `opensAt` rather than the wall clock.
 * That is what makes `BotScoreMode.TIE` actually reach a deadlock: D5's chain
 * ends at "earliest submission", so two bots that agree on every score would
 * still be separated by microseconds of scheduling jitter. It is also honest —
 * a synthetic competitor's submission time carries no competitive meaning, and
 * pretending otherwise would put noise into the audit trail.
 */
export async function runBotSubmissionsForRound(
  roundId: string,
): Promise<BotSubmissionResult> {
  const round = await db.round.findUnique({
    where: { id: roundId },
    select: {
      id: true,
      status: true,
      opensAt: true,
      tournamentId: true,
      problemId: true,
      tournament: { select: { environment: true } },
    },
  });
  if (!round) return { submitted: 0, skipped: 0 };

  // Defence in depth. Nothing should ever enqueue this for production, and if
  // something does, it stops here rather than inventing a submission.
  if (round.tournament.environment !== 'TEST') {
    logger.warn(
      { roundId, tournamentId: round.tournamentId },
      'bot submission requested for a production round; refusing',
    );
    return { submitted: 0, skipped: 0 };
  }
  if (round.status !== 'OPEN' || !round.problemId) {
    return { submitted: 0, skipped: 0 };
  }

  // Only bots that are (a) registered, (b) actually paired into this round when
  // it is a knockout, and (c) have not already submitted.
  const registrations = await db.registration.findMany({
    where: {
      tournamentId: round.tournamentId,
      status: 'ACTIVE',
      user: { isBot: true },
    },
    select: {
      userId: true,
      user: {
        select: {
          username: true,
          botProfile: { select: { submitBehaviour: true } },
        },
      },
    },
  });

  const existing = await db.submission.findMany({
    where: { roundId, userId: { in: registrations.map((r) => r.userId) } },
    select: { userId: true },
  });
  const alreadySubmitted = new Set(existing.map((row) => row.userId));

  let submitted = 0;
  let skipped = 0;

  for (const registration of registrations) {
    const behaviour = registration.user.botProfile?.submitBehaviour ?? 'ALWAYS';

    // NEVER is the whole point of the setting: it produces a no-show, which is
    // how walkovers, double-no-shows and the higher-seed fallback get exercised
    // without asking a human tester to sit out a round.
    if (behaviour === 'NEVER' || alreadySubmitted.has(registration.userId)) {
      skipped++;
      continue;
    }

    try {
      await submitSolution(
        {
          userId: registration.userId,
          roundId,
          repoUrl: botRepoUrl(registration.user.username),
          deploymentUrl: botDeploymentUrl(registration.userId, roundId),
        },
        { now: round.opensAt ?? new Date() },
      );
      submitted++;
    } catch (error) {
      // A bot that cannot submit — not paired into this knockout round, most
      // often — must not stop the others. This is the normal case for a bot
      // that has already been eliminated.
      logger.debug(
        {
          roundId,
          botUserId: registration.userId,
          err: error instanceof Error ? error.message : String(error),
        },
        'bot submission skipped',
      );
      skipped++;
    }
  }

  if (submitted > 0) {
    logger.info({ roundId, submitted, skipped }, 'bot submissions accepted');
  }
  return { submitted, skipped };
}
