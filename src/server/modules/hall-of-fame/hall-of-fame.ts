import 'server-only';
import type { RoundStage } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  awardsForPlacements,
  BADGE_CATALOGUE,
  podiumFromPlacements,
  type BadgeSlug,
} from './badges.public';

/**
 * Hall of Fame and badges (E8.4).
 *
 * Publishing turns a finished tournament into a permanent record. It is
 * **idempotent and replayable**, which is what makes it safe to trigger
 * automatically when a tournament completes *and* to re-run by hand:
 *
 * - A crash halfway through leaves nothing half-published — running it again
 *   finishes the job.
 * - A correction after the fact (an admin disqualification, a re-evaluated
 *   submission) is picked up, because the podium is re-derived from the
 *   standings on every run rather than frozen at first publish.
 * - `publishedAt` is *not* re-derived: a tournament was first published when it
 *   was first published, and the Hall of Fame orders by that.
 *
 * The record is **frozen at publication**: participant count and prize pool are
 * copied onto the row rather than read through the relation, because a
 * tournament's counters keep moving (archival, reconciliation) and history must
 * not.
 */

export interface PublishResult {
  tournamentId: string;
  championId: string | null;
  runnerUpId: string | null;
  thirdPlaceId: string | null;
  badgesAwarded: number;
  /** False when the entry already existed and was left as published. */
  created: boolean;
}

/**
 * Ensure the `Badge` rows match the code catalogue.
 *
 * Upsert rather than insert-if-missing: the description is owned by the code,
 * so a catalogue edit propagates. The slug is the identity and never changes —
 * that is what keeps already-awarded `UserBadge` rows meaningful.
 */
export async function syncBadgeCatalogue(
  client: DbClient = db,
): Promise<number> {
  let synced = 0;
  for (const badge of Object.values(BADGE_CATALOGUE)) {
    await client.badge.upsert({
      where: { slug: badge.slug },
      update: { name: badge.name, description: badge.description },
      create: {
        slug: badge.slug,
        name: badge.name,
        description: badge.description,
      },
    });
    synced++;
  }
  return synced;
}

/**
 * Publish a completed tournament: podium, badges, Hall of Fame entry.
 *
 * Refuses anything that is not COMPLETED — a Hall of Fame entry for a running
 * tournament would name a champion who has not won yet.
 */
export async function publishHallOfFame(
  tournamentId: string,
  client: DbClient = db,
): Promise<PublishResult> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      status: true,
      participantCount: true,
      prizePoolMinor: true,
      thirdPlaceEnabled: true,
    },
  });
  if (!tournament) throw new NotFoundError('That tournament does not exist');
  if (tournament.status !== 'COMPLETED') {
    throw new ConflictError(
      `Only a completed tournament can be published to the Hall of Fame (this one is ${tournament.status})`,
    );
  }

  const rankings = await client.ranking.findMany({
    where: { tournamentId },
    select: { userId: true, placement: true, qualified: true },
  });
  const podium = podiumFromPlacements(rankings);
  if (!podium.championId) {
    throw new ConflictError(
      'That tournament has no champion recorded; nothing to publish',
    );
  }

  await syncBadgeCatalogue(client);
  const badges = await client.badge.findMany({
    select: { id: true, slug: true },
  });
  const badgeIdBySlug = new Map(badges.map((badge) => [badge.slug, badge.id]));

  const awards = awardsForPlacements(rankings);
  const awardRows = awards
    .map((award) => ({
      userId: award.userId,
      badgeId: badgeIdBySlug.get(award.slug),
      tournamentId,
    }))
    .filter(
      (row): row is { userId: string; badgeId: string; tournamentId: string } =>
        typeof row.badgeId === 'string',
    );

  // `skipDuplicates` against the unique (userId, badgeId, tournamentId) key
  // makes re-publishing a no-op rather than an error.
  const awarded = await client.userBadge.createMany({
    data: awardRows,
    skipDuplicates: true,
  });

  const finalMatch = await client.match.findFirst({
    where: { tournamentId, round: { stage: 'FINAL' satisfies RoundStage } },
    select: { id: true },
  });

  const existing = await client.hallOfFame.findUnique({
    where: { tournamentId },
    select: { id: true },
  });

  await client.hallOfFame.upsert({
    where: { tournamentId },
    // The podium is re-derived on every publish so a corrected placement (an
    // admin disqualification after the fact) is reflected. The publication
    // timestamp is not touched — the tournament was first published when it was
    // first published.
    update: {
      championId: podium.championId,
      runnerUpId: podium.runnerUpId,
      thirdPlaceId: podium.thirdPlaceId,
      finalMatchId: finalMatch?.id ?? null,
    },
    create: {
      tournamentId,
      championId: podium.championId,
      runnerUpId: podium.runnerUpId,
      thirdPlaceId: podium.thirdPlaceId,
      finalMatchId: finalMatch?.id ?? null,
      participantCount: tournament.participantCount,
      prizePoolMinor: tournament.prizePoolMinor,
    },
  });

  logger.info(
    {
      tournamentId,
      championId: podium.championId,
      badgesAwarded: awarded.count,
      republished: existing !== null,
    },
    'hall of fame published',
  );

  return {
    tournamentId,
    ...podium,
    badgesAwarded: awarded.count,
    created: existing === null,
  };
}

// ───────────────────────── Reads (screens [3] and [4]) ─────────────────────

export interface HallOfFameEntry {
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  publishedAt: Date;
  participantCount: number;
  prizePoolMinor: number;
  champion: {
    userId: string;
    username: string;
    displayName: string | null;
    city: string | null;
  } | null;
  runnerUp: {
    userId: string;
    username: string;
    displayName: string | null;
  } | null;
  thirdPlace: {
    userId: string;
    username: string;
    displayName: string | null;
  } | null;
}

export async function listHallOfFame(
  options: { take?: number } = {},
  client: DbClient = db,
): Promise<HallOfFameEntry[]> {
  const entries = await client.hallOfFame.findMany({
    // Unlisted tournaments are rehearsals; they never reach the public record.
    where: { tournament: { visibility: 'PUBLIC' } },
    orderBy: { publishedAt: 'desc' },
    take: options.take ?? 50,
    include: {
      tournament: { select: { id: true, name: true, slug: true } },
    },
  });

  const userIds = [
    ...new Set(
      entries.flatMap((entry) =>
        [entry.championId, entry.runnerUpId, entry.thirdPlaceId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
  ];
  const users = await client.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true, city: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));

  const shape = (id: string | null) => {
    if (!id) return null;
    const user = byId.get(id);
    return user
      ? {
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          city: user.city,
        }
      : null;
  };

  return entries.map((entry) => ({
    tournamentId: entry.tournament.id,
    tournamentName: entry.tournament.name,
    tournamentSlug: entry.tournament.slug,
    publishedAt: entry.publishedAt,
    participantCount: entry.participantCount,
    prizePoolMinor: entry.prizePoolMinor,
    champion: shape(entry.championId),
    runnerUp: shape(entry.runnerUpId),
    thirdPlace: shape(entry.thirdPlaceId),
  }));
}

export interface UserBadgeView {
  slug: string;
  name: string;
  description: string | null;
  awardedAt: Date;
  tournamentId: string | null;
  tournamentName: string | null;
}

/**
 * A competitor's badges.
 *
 * **`publicOnly` must be set on any surface a stranger can read.** A badge
 * carries the name of the tournament that awarded it, and rehearsals run
 * UNLISTED — without the filter a public profile would announce a tournament
 * that is deliberately unannounced everywhere else. `listPublicPlacements`
 * already applies the same rule; this is the other half of it.
 *
 * `UserBadge.tournamentId` is a plain column rather than a relation, so the
 * filter is applied after the read instead of in the WHERE clause. A badge with
 * no tournament (a future global award) has nothing to hide and always shows.
 */
export async function listUserBadges(
  userId: string,
  options: { publicOnly?: boolean } = {},
  client: DbClient = db,
): Promise<UserBadgeView[]> {
  const rows = await client.userBadge.findMany({
    where: { userId },
    orderBy: { awardedAt: 'desc' },
    include: { badge: true },
  });

  const tournamentIds = [
    ...new Set(
      rows
        .map((row) => row.tournamentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const tournaments = await client.tournament.findMany({
    where: {
      id: { in: tournamentIds },
      ...(options.publicOnly ? { visibility: 'PUBLIC', archivedAt: null } : {}),
    },
    select: { id: true, name: true },
  });
  const nameById = new Map(tournaments.map((t) => [t.id, t.name]));

  return rows
    .filter(
      (row) =>
        !options.publicOnly ||
        row.tournamentId === null ||
        nameById.has(row.tournamentId),
    )
    .map((row) => ({
      slug: row.badge.slug,
      name: row.badge.name,
      description: row.badge.description,
      awardedAt: row.awardedAt,
      tournamentId: row.tournamentId,
      tournamentName: row.tournamentId
        ? (nameById.get(row.tournamentId) ?? null)
        : null,
    }));
}

/** Badge slugs a user holds — for the compact profile summary. */
export async function userBadgeSlugs(
  userId: string,
  client: DbClient = db,
): Promise<BadgeSlug[]> {
  const rows = await client.userBadge.findMany({
    where: { userId },
    select: { badge: { select: { slug: true } } },
  });
  return rows.map((row) => row.badge.slug as BadgeSlug);
}
