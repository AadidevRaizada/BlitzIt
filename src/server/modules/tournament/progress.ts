import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { RoundStage } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { resolveTournamentConfig } from './config';
import { knockoutStages, toLifecycleState } from './lifecycle';
import {
  advanceStage,
  getRoundCompletion,
  resolveSuddenDeathMatches,
} from './advancement';
import { closeRound, completeRound, openRound } from './rounds';
import { completeSettledSuddenDeathRounds } from './sudden-death';
import { applyTransition, type TransitionResult } from './state';
import { syncTournamentNotifications } from './notifications';
import { publishHallOfFame } from '@/server/modules/hall-of-fame';
import { isBracketSize } from './config';

/**
 * Automatic round progression (E3).
 *
 * The driver that turns "an evaluation landed" into "the bracket moved". It
 * sits above `advancement.ts` (which decides matches) and `state.ts` (which
 * changes lifecycle state) and is the only thing that knows both.
 *
 * It is a **pull**, not a push: it derives everything it does from persisted
 * state, so it can be triggered by a job, by cron, by an admin button, or by a
 * verification script, and running it twice is harmless. Nothing about the
 * tournament's position lives in memory between calls.
 */

export interface ProgressResult {
  tournamentId: string;
  /** Stage the tournament was in when the pass started. */
  startedAtStage: RoundStage | null;
  /** Matches decided during this pass. */
  matchesDecided: number;
  /** Matches stuck on an unresolved tie (D5.6 — needs sudden death). */
  matchesTied: number;
  /** Sudden-death challenges decided during this pass (E6). */
  suddenDeathResolved: number;
  /** Simulation rounds sealed during this pass. */
  simulationRoundsClosed: number;
  /** Simulation rounds opened during this pass. */
  simulationRoundsOpened: number;
  /** Lifecycle transitions this pass triggered, in order. */
  transitions: TransitionResult[];
  /** Notifications raised by this pass (E8.3). Zero on a replay. */
  notificationsRaised: number;
  /** True when the tournament reached COMPLETED during this pass. */
  completed: boolean;
}

/**
 * Drive the SIMULATION phase: seal a round whose window has expired and open
 * the next one.
 *
 * Without this, `START_SIMULATION` opens round 1 and rounds 2 and 3 stay
 * `PENDING` forever — D13 sums three rounds, but only one would ever be
 * playable. Like the knockout driver this is a pull off persisted state, so
 * cron, a job, or an admin can all call it and calling it twice is harmless.
 */
export async function progressSimulation(
  tournamentId: string,
): Promise<{ closed: number; opened: number; allComplete: boolean }> {
  const rounds = await db.round.findMany({
    where: { tournamentId, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
    select: { id: true, sequence: true, status: true, deadlineAt: true },
  });

  let closed = 0;
  let opened = 0;
  const now = new Date();

  for (const round of rounds) {
    if (round.status === 'COMPLETED') continue;

    if (round.status === 'OPEN') {
      if (round.deadlineAt !== null && round.deadlineAt <= now) {
        await closeRound(db, round.id, now);
        await completeRound(db, round.id);
        closed++;
        continue;
      }
      // Still running — nothing after it may open yet.
      break;
    }

    if (round.status === 'JUDGING') {
      await completeRound(db, round.id);
      closed++;
      continue;
    }

    // PENDING and every earlier round is finished: this one is up next.
    await openRound(db, round.id, now);
    opened++;
    break;
  }

  const remaining = await db.round.count({
    where: { tournamentId, type: 'SIMULATION', status: { not: 'COMPLETED' } },
  });

  if (closed > 0 || opened > 0) {
    logger.info(
      { tournamentId, closed, opened, remaining },
      'simulation phase progressed',
    );
  }

  return { closed, opened, allComplete: remaining === 0 };
}

/**
 * Decide everything decidable, then advance as far as the persisted state
 * allows — possibly several rounds in one pass when a bracket is full of byes.
 */
export async function progressTournament(
  tournamentId: string,
  options: { actorId?: string | null; runBy?: string } = {},
): Promise<ProgressResult> {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }

  const result: ProgressResult = {
    tournamentId,
    startedAtStage: tournament.currentStage,
    matchesDecided: 0,
    matchesTied: 0,
    suddenDeathResolved: 0,
    simulationRoundsClosed: 0,
    simulationRoundsOpened: 0,
    notificationsRaised: 0,
    transitions: [],
    completed: tournament.status === 'COMPLETED',
  };

  // The simulation phase has its own round progression. One driver covers both
  // phases so a caller never has to know which one the tournament is in.
  if (tournament.status === 'SIMULATION') {
    const simulation = await progressSimulation(tournamentId);
    result.simulationRoundsClosed = simulation.closed;
    result.simulationRoundsOpened = simulation.opened;
    return result;
  }

  if (tournament.status !== 'LIVE') {
    logger.debug(
      { tournamentId, status: tournament.status },
      'progress requested for a tournament that is not LIVE; nothing to do',
    );
    return result;
  }
  if (!isBracketSize(tournament.bracketSize)) {
    throw new NotFoundError(
      `tournament ${tournamentId} is LIVE without a valid bracket size`,
    );
  }

  const config = resolveTournamentConfig(tournament);
  const stages = knockoutStages({
    bracketSize: tournament.bracketSize,
    thirdPlaceEnabled: tournament.thirdPlaceEnabled,
  });

  // Bounded by the stage count: each iteration either advances a stage or
  // stops, so this cannot loop indefinitely even if state is inconsistent.
  for (let step = 0; step <= stages.length; step++) {
    const current = await db.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { status: true, currentStage: true },
    });
    if (current.status !== 'LIVE' || !current.currentStage) break;

    const stage = current.currentStage;

    // Seal an expired window before deciding. A round whose deadline has passed
    // is over whether or not anybody told it so, and absence-based outcomes
    // (walkover, no-show) are only legitimate once it is. Doing this here means
    // the deadline is enforced by the same pull that advances the bracket —
    // there is no separate timer to miss.
    const round = await db.round.findFirst({
      where: { tournamentId, stage },
      select: { id: true, status: true, deadlineAt: true },
    });
    if (
      round?.status === 'OPEN' &&
      round.deadlineAt !== null &&
      round.deadlineAt < new Date()
    ) {
      await closeRound(db, round.id);
      logger.info(
        { tournamentId, stage, roundId: round.id },
        'submission window expired; round sealed for judging',
      );
    }

    // Seal an expired SUDDEN_DEATH window too, then decide those matches first:
    // a sudden-death result unsticks a match in the CURRENT round, so resolving
    // it before the stage pass lets the round complete in the same call rather
    // than needing a second one.
    const suddenDeathRounds = await db.round.findMany({
      where: { tournamentId, stage: 'SUDDEN_DEATH', status: 'OPEN' },
      select: { id: true, deadlineAt: true },
    });
    for (const sdRound of suddenDeathRounds) {
      if (sdRound.deadlineAt !== null && sdRound.deadlineAt < new Date()) {
        await closeRound(db, sdRound.id);
      }
    }

    const suddenDeathDecisions = await db.$transaction(
      (tx) => resolveSuddenDeathMatches(tx, tournamentId, config),
      { timeout: 60_000, maxWait: 15_000 },
    );
    result.suddenDeathResolved += suddenDeathDecisions.filter(
      (decision) => decision.changed && decision.outcome.kind !== 'TIE',
    ).length;

    // Close out any sudden-death round that is fully decided. No lifecycle
    // transition does this — COMPLETE finishes the FINAL round only — so
    // without it a tournament could reach COMPLETED with a sudden-death round
    // still OPEN and nothing left running to tidy it.
    await completeSettledSuddenDeathRounds(db, tournamentId);

    // Decide the whole round atomically: a half-advanced round would leave
    // winners sitting in slots whose round never completed.
    //
    // The tournament row is locked FIRST, with the same `FOR UPDATE` that
    // `applyTransition` takes, and the state is re-read INSIDE the lock.
    // Without it a concurrent CANCEL could commit between the read above and
    // these writes, and we would decide matches into a cancelled tournament.
    const decisions = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Tournament" WHERE "id" = ${tournamentId} FOR UPDATE`,
        );
        const locked = await tx.tournament.findUniqueOrThrow({
          where: { id: tournamentId },
          select: { status: true, currentStage: true },
        });
        if (locked.status !== 'LIVE' || locked.currentStage !== stage) {
          logger.info(
            {
              tournamentId,
              expectedStage: stage,
              actualStatus: locked.status,
              actualStage: locked.currentStage,
            },
            'tournament moved while progressing; abandoning this pass',
          );
          return null;
        }
        return advanceStage(tx, tournamentId, stage, config);
      },
      { timeout: 60_000, maxWait: 15_000 },
    );

    if (decisions === null) break;
    result.matchesDecided += decisions.filter(
      (d) => d.changed && d.outcome.kind !== 'TIE',
    ).length;
    result.matchesTied += decisions.filter(
      (d) => d.outcome.kind === 'TIE',
    ).length;

    const completion = await getRoundCompletion(tournamentId, stage);
    if (!completion.complete) {
      logger.info(
        {
          tournamentId,
          stage,
          decided: completion.decided,
          total: completion.total,
          tied: completion.tied,
        },
        'round is not complete; stopping progression',
      );
      break;
    }

    const isLastStage = stages[stages.length - 1] === stage;
    const transition = isLastStage ? 'COMPLETE' : 'ADVANCE_STAGE';
    const applied = await applyTransition(tournamentId, transition, {
      actorId: options.actorId ?? null,
      runBy: options.runBy ?? 'system',
    });
    result.transitions.push(applied);

    if (transition === 'COMPLETE') {
      result.completed = true;
      break;
    }
  }

  // Notifications are derived from the state this pass left behind (E8.3), not
  // raised at each decision point — so anything that reaches a state by another
  // path (a replayed job, a forced transition, a restart resuming mid-round)
  // still notifies. Idempotent by dedupe key, and outside every transaction
  // above because it enqueues email jobs.
  //
  // Deliberately non-fatal: a notification failure must never make a completed
  // round look like a failed advancement. The bracket has already moved and
  // that is what matters; the next pass re-derives anything missed.
  // A finished tournament becomes a permanent record (E8.4). Published here
  // rather than left to an operator so the Hall of Fame is never one forgotten
  // click behind reality; idempotent and re-runnable, so a correction after the
  // fact still propagates. Before the notifications, so TOURNAMENT_COMPLETE
  // goes out to a world where the champion is already published.
  if (result.completed) {
    try {
      await publishHallOfFame(tournamentId);
    } catch (error) {
      logger.error(
        {
          tournamentId,
          err: error instanceof Error ? error.message : String(error),
        },
        'hall of fame publication failed; the tournament is still COMPLETED',
      );
    }
  }

  try {
    const notified = await syncTournamentNotifications(tournamentId);
    result.notificationsRaised = notified.raised;
  } catch (error) {
    logger.error(
      {
        tournamentId,
        err: error instanceof Error ? error.message : String(error),
      },
      'notification sync failed after progression; the bracket is unaffected',
    );
  }

  return result;
}

/**
 * Convenience read: where is this tournament, in one call?
 * Used by the verification suites and by ops tooling.
 */
export async function getTournamentProgress(tournamentId: string) {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      slug: true,
      status: true,
      currentStage: true,
      bracketSize: true,
      thirdPlaceEnabled: true,
      participantCount: true,
    },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }

  const state = toLifecycleState(tournament.status, tournament.currentStage);
  const completion = tournament.currentStage
    ? await getRoundCompletion(tournamentId, tournament.currentStage)
    : null;

  return { ...tournament, state, completion };
}
