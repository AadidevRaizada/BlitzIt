import './load-env';
import { db } from '../src/server/db';

const BOT_PREFIX = 'prod-bot-score-';

async function counts() {
  const tournamentJobRows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "EvaluationJob"
    WHERE "submissionId" IS NOT NULL
       OR "name" IN ('advanceBracket', 'seedTournament', 'tournamentTransition')
       OR "payload" ? 'tournamentId'
       OR "payload" ? 'roundId'
  `;

  const [
    tournaments,
    rounds,
    matches,
    submissions,
    submissionRevisions,
    evaluations,
    rankings,
    registrations,
    payments,
    webhookEvents,
    payouts,
    hallOfFame,
    opsEvents,
    tournamentNotifications,
    tournamentBadges,
    botUsers,
  ] = await Promise.all([
    db.tournament.count(),
    db.round.count(),
    db.match.count(),
    db.submission.count(),
    db.submissionRevision.count(),
    db.evaluation.count(),
    db.ranking.count(),
    db.registration.count(),
    db.payment.count(),
    db.webhookEvent.count(),
    db.payout.count(),
    db.hallOfFame.count(),
    db.opsEvent.count(),
    db.notification.count({ where: { tournamentId: { not: null } } }),
    db.userBadge.count({ where: { tournamentId: { not: null } } }),
    db.user.count({ where: { username: { startsWith: BOT_PREFIX } } }),
  ]);

  return {
    tournaments,
    rounds,
    matches,
    submissions,
    submissionRevisions,
    evaluations,
    evaluationJobs: Number(tournamentJobRows[0]?.count ?? 0),
    rankings,
    registrations,
    payments,
    webhookEvents,
    payouts,
    hallOfFame,
    opsEvents,
    tournamentNotifications,
    tournamentBadges,
    botUsers,
  };
}

async function main() {
  const before = await counts();

  const tournamentNotificationIds = (
    await db.notification.findMany({
      where: { tournamentId: { not: null } },
      select: { id: true },
    })
  ).map((row) => row.id);

  await db.$transaction(
    async (tx) => {
      if (tournamentNotificationIds.length > 0) {
        await tx.$executeRaw`
          DELETE FROM "EvaluationJob"
          WHERE "name" = 'sendEmail'
            AND "payload"->>'notificationId' = ANY(${tournamentNotificationIds})
        `;
      }

      await tx.evaluationJob.deleteMany({
        where: {
          OR: [
            { submissionId: { not: null } },
            {
              name: {
                in: [
                  'advanceBracket',
                  'seedTournament',
                  'tournamentTransition',
                ],
              },
            },
          ],
        },
      });

      await tx.$executeRaw`
        DELETE FROM "EvaluationJob"
        WHERE "payload" ? 'tournamentId'
           OR "payload" ? 'roundId'
      `;

      await tx.notification.deleteMany({
        where: { tournamentId: { not: null } },
      });
      await tx.userBadge.deleteMany({
        where: { tournamentId: { not: null } },
      });
      await tx.hallOfFame.deleteMany({});
      await tx.payout.deleteMany({});
      await tx.webhookEvent.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.evaluation.deleteMany({});
      await tx.submissionRevision.deleteMany({});
      await tx.submission.deleteMany({});

      await tx.match.updateMany({
        data: {
          nextMatchId: null,
          loserNextMatchId: null,
          resolvesMatchId: null,
        },
      });
      await tx.match.deleteMany({});
      await tx.ranking.deleteMany({});
      await tx.registration.deleteMany({});
      await tx.opsEvent.deleteMany({});
      await tx.round.deleteMany({});
      await tx.tournament.deleteMany({});

      await tx.user.deleteMany({
        where: { username: { startsWith: BOT_PREFIX } },
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  const after = await counts();
  console.log(JSON.stringify({ before, after }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
