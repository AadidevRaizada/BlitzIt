import 'server-only';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import {
  raiseNotifications,
  dispatchNotificationEmails,
  type NotificationIntent,
} from '@/server/modules/notification';
import { logger } from '@/lib/logger';

/**
 * Tournament → notification triggers (E8.3).
 *
 * ## Why this is a sweep, not a call at every site
 *
 * The obvious design scatters `raiseNotification(...)` through the lifecycle:
 * one in `openRound`, one in `decideAndPropagate`, one in `applyTransition`.
 * That couples the bracket engine to a delivery concern, puts a write inside
 * transactions that must stay fast, and — worst — makes notifications depend on
 * *control flow*. Anything that reaches a state by another path (a replayed
 * job, an admin forcing a transition, a restart resuming mid-round) silently
 * notifies nobody.
 *
 * So this derives notifiable events from **persisted state**, exactly as
 * `progressTournament` derives what to advance. Every intent is keyed by what
 * happened, the key is unique, and inserting is `skipDuplicates` — so running
 * the sweep once or fifty times produces the same notifications. A competitor
 * gets told they advanced because the match says they did, not because a
 * particular function call happened to run.
 *
 * ## Ownership
 *
 * This file lives in the Tournament module because it reads tournament state,
 * which the Tournament module owns. It calls the Notification module's public
 * surface and knows nothing about email, templates or the queue. The dependency
 * runs one way — Tournament → Notification — and Notification never reads a
 * tournament.
 */

export interface NotificationSyncResult {
  tournamentId: string;
  raised: number;
  emailsQueued: number;
}

/**
 * Derive and raise every notification a tournament's current state implies.
 *
 * **Must be called outside a transaction.** It enqueues email jobs, and a job
 * enqueued inside a transaction that later rolls back would point at a
 * notification row that never existed.
 */
export async function syncTournamentNotifications(
  tournamentId: string,
  client: DbClient = db,
): Promise<NotificationSyncResult> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      seededAt: true,
    },
  });
  if (!tournament) {
    return { tournamentId, raised: 0, emailsQueued: 0 };
  }

  const base = {
    tournamentName: tournament.name,
    tournamentSlug: tournament.slug,
    tournamentId: tournament.id,
  };
  const intents: NotificationIntent[] = [];

  // ── Seeded ────────────────────────────────────────────────────────────
  // Scoped to the tournament: a competitor is seeded once, whatever their seed
  // is later recomputed to.
  if (tournament.seededAt) {
    const qualified = await client.ranking.findMany({
      where: { tournamentId, qualified: true },
      select: { userId: true, seed: true },
    });
    for (const ranking of qualified) {
      intents.push({
        userId: ranking.userId,
        type: 'SEEDED',
        scopeId: tournamentId,
        tournamentId,
        payload: { ...base, seed: ranking.seed ?? undefined },
      });
    }
  }

  // ── Round open ────────────────────────────────────────────────────────
  // Both competitors in every match of an OPEN knockout round. Scoped to the
  // round, so re-opening or re-reading never notifies twice, and a competitor
  // playing two rounds gets one notification each.
  const openRounds = await client.round.findMany({
    where: { tournamentId, type: 'KNOCKOUT', status: 'OPEN' },
    select: {
      id: true,
      stage: true,
      deadlineAt: true,
      matches: {
        select: {
          id: true,
          competitorAId: true,
          competitorBId: true,
        },
      },
    },
  });

  const opponentIds = new Set<string>();
  for (const round of openRounds) {
    for (const match of round.matches) {
      if (match.competitorAId) opponentIds.add(match.competitorAId);
      if (match.competitorBId) opponentIds.add(match.competitorBId);
    }
  }

  // ── Advanced / eliminated ─────────────────────────────────────────────
  const decided = await client.match.findMany({
    where: {
      tournamentId,
      status: 'DECIDED',
      winnerId: { not: null },
      // Terminal matches are covered by TOURNAMENT_COMPLETE, which can say
      // what someone actually finished rather than "you advanced" to nothing.
      //
      // THIRD_PLACE belongs here as much as FINAL does: its winner finishes
      // third and plays no further round, so an ADVANCED notification would
      // tell them "the next round opens on schedule" when there is no next
      // round. Its loser finishing fourth is not "eliminated" in any sense
      // they would recognise either — they reached the last four.
      round: { stage: { notIn: ['FINAL', 'THIRD_PLACE'] } },
    },
    select: {
      id: true,
      winnerId: true,
      loserId: true,
      round: { select: { stage: true } },
    },
  });

  for (const match of decided) {
    if (match.winnerId) opponentIds.add(match.winnerId);
    if (match.loserId) opponentIds.add(match.loserId);
  }

  // One lookup for every name any of these notifications might mention.
  const users = await client.user.findMany({
    where: { id: { in: [...opponentIds] } },
    select: { id: true, username: true, displayName: true },
  });
  const nameById = new Map(
    users.map((user) => [user.id, user.displayName ?? user.username]),
  );

  for (const round of openRounds) {
    for (const match of round.matches) {
      const pairs: Array<[string | null, string | null]> = [
        [match.competitorAId, match.competitorBId],
        [match.competitorBId, match.competitorAId],
      ];
      for (const [userId, opponentId] of pairs) {
        // A bye has nobody to notify on one side, and nobody to name on the
        // other — the notification still goes out, just without an opponent.
        if (!userId) continue;
        intents.push({
          userId,
          type: 'ROUND_OPEN',
          scopeId: round.id,
          tournamentId,
          payload: {
            ...base,
            stage: round.stage,
            roundId: round.id,
            matchId: match.id,
            opponent: opponentId ? nameById.get(opponentId) : undefined,
            deadlineAt: round.deadlineAt?.toISOString(),
          },
        });
      }
    }
  }

  for (const match of decided) {
    if (match.winnerId) {
      intents.push({
        userId: match.winnerId,
        type: 'ADVANCED',
        scopeId: match.id,
        tournamentId,
        payload: {
          ...base,
          stage: match.round.stage,
          matchId: match.id,
          opponent: match.loserId ? nameById.get(match.loserId) : undefined,
        },
      });
    }
    if (match.loserId) {
      intents.push({
        userId: match.loserId,
        type: 'ELIMINATED',
        scopeId: match.id,
        tournamentId,
        payload: {
          ...base,
          stage: match.round.stage,
          matchId: match.id,
        },
      });
    }
  }

  // ── Tournament complete ───────────────────────────────────────────────
  if (tournament.status === 'COMPLETED') {
    const rankings = await client.ranking.findMany({
      where: { tournamentId },
      select: { userId: true, placement: true },
    });
    const championId = rankings.find((r) => r.placement === 1)?.userId ?? null;
    const champion = championId
      ? await client.user.findUnique({
          where: { id: championId },
          select: { username: true, displayName: true },
        })
      : null;
    const championName = champion
      ? (champion.displayName ?? champion.username)
      : undefined;

    for (const ranking of rankings) {
      intents.push({
        userId: ranking.userId,
        type: 'TOURNAMENT_COMPLETE',
        scopeId: tournamentId,
        tournamentId,
        payload: {
          ...base,
          championName,
          placement: ranking.placement ?? undefined,
        },
      });
    }
  }

  if (intents.length === 0) {
    return { tournamentId, raised: 0, emailsQueued: 0 };
  }

  const { created, createdKeys } = await raiseNotifications(intents, client);
  // Only the keys that were actually created are dispatched. A sweep that
  // inserted nothing must not enqueue a second send for an event already
  // delivered.
  const emailsQueued = await dispatchNotificationEmails(createdKeys);

  if (created > 0) {
    logger.info(
      {
        tournamentId,
        raised: created,
        emailsQueued,
        considered: intents.length,
      },
      'tournament notifications synced',
    );
  }
  return { tournamentId, raised: created, emailsQueued };
}

/**
 * Confirm one competitor's registration.
 *
 * Raised at the point of registering rather than by the sweep: the sweep runs
 * during progression, which is long after somebody signs up, and a confirmation
 * that arrives hours later is not a confirmation.
 */
export async function notifyRegistrationConfirmed(
  tournamentId: string,
  userId: string,
  client: DbClient = db,
): Promise<number> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, name: true, slug: true },
  });
  if (!tournament) return 0;

  const { createdKeys } = await raiseNotifications(
    [
      {
        userId,
        type: 'REGISTRATION_CONFIRMED',
        scopeId: tournamentId,
        tournamentId,
        payload: {
          tournamentName: tournament.name,
          tournamentSlug: tournament.slug,
          tournamentId: tournament.id,
        },
      },
    ],
    client,
  );
  return dispatchNotificationEmails(createdKeys);
}
