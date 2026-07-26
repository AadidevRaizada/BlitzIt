import 'server-only';
import { db } from '@/server/db';

export async function exportUserData(userId: string) {
  const [user, registrations, submissions, payments, notifications] =
    await Promise.all([
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          city: true,
          country: true,
          createdAt: true,
          updatedAt: true,
          profile: {
            select: {
              bio: true,
              githubUsername: true,
              websiteUrl: true,
              twitterHandle: true,
              preferredTimezone: true,
              stats: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          termsAcceptances: {
            select: { version: true, acceptedAt: true },
            orderBy: { acceptedAt: 'desc' },
          },
        },
      }),
      db.registration.findMany({
        where: { userId },
        select: {
          id: true,
          tournamentId: true,
          paymentId: true,
          status: true,
          registeredAt: true,
          tournament: { select: { name: true, slug: true, status: true } },
        },
        orderBy: { registeredAt: 'desc' },
      }),
      db.submission.findMany({
        where: { userId },
        select: {
          id: true,
          tournamentId: true,
          roundId: true,
          matchId: true,
          problemId: true,
          category: true,
          repoUrl: true,
          deploymentUrl: true,
          commitSha: true,
          version: true,
          submittedAt: true,
          sealedAt: true,
          status: true,
          revisions: {
            select: {
              version: true,
              repoUrl: true,
              deploymentUrl: true,
              commitSha: true,
              submittedAt: true,
            },
            orderBy: { version: 'asc' },
          },
        },
        orderBy: { submittedAt: 'desc' },
      }),
      db.payment.findMany({
        where: { userId },
        select: {
          id: true,
          tournamentId: true,
          provider: true,
          providerOrderId: true,
          providerPaymentId: true,
          amountMinor: true,
          currency: true,
          status: true,
          signatureVerified: true,
          paidAt: true,
          refundedAt: true,
          refundRequiredAt: true,
          refundReason: true,
          createdAt: true,
          updatedAt: true,
          webhookEvents: {
            select: {
              providerEventId: true,
              eventType: true,
              signatureVerified: true,
              outcome: true,
              errorMessage: true,
              receivedAt: true,
            },
            orderBy: { receivedAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.notification.findMany({
        where: { userId },
        select: {
          id: true,
          type: true,
          channel: true,
          payload: true,
          status: true,
          sentAt: true,
          readAt: true,
          tournamentId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    user,
    registrations,
    submissions,
    payments,
    notifications,
  };
}
