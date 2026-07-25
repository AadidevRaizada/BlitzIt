import 'server-only';
import type { Match, MatchSlot, RoundStage } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { TournamentConfig } from './config';
import {
  decideMatch,
  SUDDEN_DEATH_CHAIN,
  type CompetitorResult,
  type MatchOutcome,
} from './win-rule';
import { applySuddenDeathResult } from './sudden-death';

/**
 * Match advancement (E3, blueprint E6.2).
 *
 * Reads persisted state, applies the pure win rule, writes the result, and
 * propagates the winner (and, for the semi-finals, the loser) into the slots
 * the bracket already reserved. It never creates matches — the topology was
 * fully materialised by `bracket.ts` at generation time — and it never
 * evaluates anything; it only reads `Evaluation` rows the engine wrote.
 *
 * Everything is idempotent and resumable: a decided match is never re-decided,
 * and re-running the whole pass after a crash converges on the same state.
 */

/** Submission states that mean "a score may still arrive". */
const PENDING_SUBMISSION_STATUSES = ['RECEIVED', 'QUEUED', 'JUDGING'] as const;

export interface MatchDecision {
  matchId: string;
  stage: RoundStage;
  bracketPosition: number;
  outcome: MatchOutcome;
  /** True when this call is what changed the match. */
  changed: boolean;
}

async function loadCompetitor(
  client: DbClient,
  roundId: string,
  userId: string | null,
  seed: number | null,
): Promise<CompetitorResult | null> {
  if (!userId) return null;

  const submission = await client.submission.findUnique({
    where: { userId_roundId: { userId, roundId } },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      evaluation: {
        select: {
          overallScore: true,
          functionalScore: true,
          testsPassed: true,
          performanceScore: true,
          aiScore: true,
        },
      },
    },
  });

  if (!submission) {
    return {
      userId,
      seed,
      submissionId: null,
      submittedAt: null,
      evaluationPending: false,
      overallScore: null,
      functionalScore: null,
      testsPassed: null,
      performanceScore: null,
      aiScore: null,
    };
  }

  const pending =
    (PENDING_SUBMISSION_STATUSES as readonly string[]).includes(
      submission.status,
    ) ||
    (submission.status === 'SCORED' && !submission.evaluation);

  // A DISQUALIFIED submission scores nothing even if an Evaluation exists —
  // otherwise disqualification would be cosmetic.
  const evaluation =
    submission.status === 'DISQUALIFIED' ? null : submission.evaluation;

  return {
    userId,
    seed,
    submissionId: submission.id,
    submittedAt: submission.submittedAt,
    evaluationPending: pending,
    overallScore: evaluation?.overallScore ?? null,
    functionalScore: evaluation?.functionalScore ?? null,
    testsPassed: evaluation?.testsPassed ?? null,
    performanceScore: evaluation?.performanceScore ?? null,
    aiScore: evaluation?.aiScore ?? null,
  };
}

/**
 * Can the empty side of this match ever be filled?
 *
 * A first-round slot with no seed is permanently empty (the seed was beyond the
 * qualified field). A later slot is permanently empty only once its feeder is
 * decided with no winner — i.e. a bye cascade reached it.
 */
async function isSlotPermanentlyEmpty(
  client: DbClient,
  match: Match,
  slot: MatchSlot,
): Promise<boolean> {
  const feeder = await client.match.findFirst({
    where: { nextMatchId: match.id, nextMatchSlot: slot },
    select: { status: true, winnerId: true },
  });
  const loserFeeder = feeder
    ? null
    : await client.match.findFirst({
        where: { loserNextMatchId: match.id, loserNextMatchSlot: slot },
        select: { status: true, loserId: true },
      });

  if (feeder) return feeder.status === 'DECIDED' && feeder.winnerId === null;
  if (loserFeeder) {
    return loserFeeder.status === 'DECIDED' && loserFeeder.loserId === null;
  }
  // No feeder at all: this is a first-round slot, fed only by the seed list.
  return true;
}

/**
 * Decide one match if it is decidable, persist the result, and push the winner
 * (and third-place-bound loser) into the next round's reserved slots.
 *
 * Returns the outcome without writing when the match is not yet decidable
 * (`PENDING`) or when every tie-break failed (`TIE` — flagged for sudden death,
 * which is a later epic).
 */
export async function decideAndPropagate(
  client: DbClient,
  matchId: string,
  config: TournamentConfig,
): Promise<MatchDecision> {
  const match = await client.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundError(`match ${matchId} not found`);

  const round = await client.round.findUniqueOrThrow({
    where: { id: match.roundId },
    select: { stage: true, status: true, deadlineAt: true },
  });

  const base = {
    matchId: match.id,
    stage: round.stage,
    bracketPosition: match.bracketPosition,
  };

  // A round that never opened is not "closed" in the sense that matters here —
  // but it also cannot have submissions, so only a structurally determined
  // match (bye/void) can be resolved from it, and `decideMatch` handles those
  // before it consults the window.
  const now = new Date();
  const windowClosed =
    round.status === 'JUDGING' ||
    round.status === 'COMPLETED' ||
    (round.deadlineAt !== null && now > round.deadlineAt);

  // Already decided: never re-decide. This is what makes the whole advancement
  // pass safe to re-run after a crash or a duplicate job.
  if (match.status === 'DECIDED') {
    return {
      ...base,
      changed: false,
      outcome: match.winnerId
        ? {
            kind: match.winReason === 'BYE' ? 'BYE' : 'DECIDED',
            winnerId: match.winnerId,
            loserId: match.loserId,
            reason: match.winReason ?? 'ADMIN',
          }
        : { kind: 'VOID', winnerId: null, loserId: null, reason: null },
    } as MatchDecision;
  }

  const a = await loadCompetitor(
    client,
    match.roundId,
    match.competitorAId,
    match.seedA,
  );
  const b = await loadCompetitor(
    client,
    match.roundId,
    match.competitorBId,
    match.seedB,
  );

  // An unoccupied slot only counts as a bye once it can never be filled.
  // Otherwise a match whose feeder is still playing would be handed a bye.
  if (!a && !(await isSlotPermanentlyEmpty(client, match, 'A'))) {
    return {
      ...base,
      changed: false,
      outcome: { kind: 'PENDING', winnerId: null, loserId: null, reason: null },
    };
  }
  if (!b && !(await isSlotPermanentlyEmpty(client, match, 'B'))) {
    return {
      ...base,
      changed: false,
      outcome: { kind: 'PENDING', winnerId: null, loserId: null, reason: null },
    };
  }

  const isSuddenDeath = round.stage === 'SUDDEN_DEATH';
  const outcome = decideMatch(a, b, {
    advanceHigherSeedOnDoubleNoShow: config.advanceHigherSeedOnDoubleNoShow,
    windowClosed,
    // D14: a sudden-death challenge is decided on Functional score alone, then
    // tests passed, then earliest submission. The other dimensions are not even
    // evaluated at this stage (D20 `functional-only`), so the D5 chain would be
    // comparing zeroes.
    ...(isSuddenDeath ? { chain: SUDDEN_DEATH_CHAIN } : {}),
  });

  if (outcome.kind === 'PENDING') {
    if (match.status === 'PENDING') {
      await client.match.update({
        where: { id: match.id },
        data: { status: 'JUDGING' },
      });
    }
    return { ...base, outcome, changed: false };
  }

  if (outcome.kind === 'TIE') {
    await client.match.update({
      where: { id: match.id },
      data: { status: 'JUDGING', tieUnresolved: true },
    });
    logger.warn(
      { matchId: match.id, stage: base.stage, isSuddenDeath },
      isSuddenDeath
        ? 'sudden-death challenge is ITSELF tied; an admin must open another one'
        : 'match is tied after every D5 tie-break; needs a sudden-death challenge',
    );
    return { ...base, outcome, changed: true };
  }

  // Claim the decision with a CONDITIONAL update. Two advancement passes can
  // legitimately overlap (a retried job, cron and an admin button at once) and
  // the read above is not serialised against them. `decideMatch` is
  // deterministic, so a double decision would agree — but propagation must
  // still happen exactly once per match, and making that structural beats
  // relying on the writes being coincidentally idempotent.
  const decidedAt = new Date();
  const claimed = await client.match.updateMany({
    where: { id: match.id, status: { not: 'DECIDED' } },
    data: {
      status: 'DECIDED',
      winnerId: outcome.winnerId,
      loserId: outcome.loserId,
      winReason: outcome.reason,
      tieUnresolved: false,
      decidedAt,
      submissionAId: a?.submissionId ?? null,
      submissionBId: b?.submissionId ?? null,
    },
  });

  if (claimed.count === 0) {
    // Another pass decided it first. It owns the propagation.
    logger.debug(
      { matchId: match.id, stage: base.stage },
      'match was decided concurrently; skipping propagation',
    );
    return { ...base, outcome, changed: false };
  }

  if (match.resolvesMatchId) {
    // A sudden-death match settles another match rather than advancing itself.
    // The winner is written onto the original, and advancement continues from
    // THERE using the topology the original already owns.
    const resolved = await applySuddenDeathResult(client, {
      id: match.id,
      resolvesMatchId: match.resolvesMatchId,
      winnerId: outcome.winnerId,
      loserId: outcome.loserId,
    });
    if (resolved) {
      const originalRound = await client.round.findUniqueOrThrow({
        where: { id: resolved.roundId },
        select: { stage: true },
      });
      await propagate(client, resolved, outcome.winnerId, outcome.loserId);
      // Ranked against the ORIGINAL stage: the loser went out at the
      // quarter-final they were tied in, not "at SUDDEN_DEATH", which is not a
      // stage anybody is eliminated from and would corrupt the placement bands.
      await updateRankingsForMatch(
        client,
        resolved,
        outcome,
        originalRound.stage,
      );
    }
    return { ...base, outcome, changed: true };
  }

  await propagate(client, match, outcome.winnerId, outcome.loserId);
  await updateRankingsForMatch(client, match, outcome, base.stage);

  return { ...base, outcome, changed: true };
}

/** Write the winner and (third place only) the loser into their reserved slots. */
async function propagate(
  client: DbClient,
  match: Match,
  winnerId: string | null,
  loserId: string | null,
): Promise<void> {
  if (match.nextMatchId && match.nextMatchSlot) {
    await writeSlot(
      client,
      match.nextMatchId,
      match.nextMatchSlot,
      winnerId,
      slotSeed(match, winnerId),
    );
  }
  if (match.loserNextMatchId && match.loserNextMatchSlot) {
    await writeSlot(
      client,
      match.loserNextMatchId,
      match.loserNextMatchSlot,
      loserId,
      slotSeed(match, loserId),
    );
  }
}

/** The seed the given competitor occupied in this match, for the next round. */
function slotSeed(match: Match, userId: string | null): number | null {
  if (!userId) return null;
  if (match.competitorAId === userId) return match.seedA;
  if (match.competitorBId === userId) return match.seedB;
  return null;
}

async function writeSlot(
  client: DbClient,
  matchId: string,
  slot: MatchSlot,
  userId: string | null,
  seed: number | null,
): Promise<void> {
  await client.match.update({
    where: { id: matchId },
    data:
      slot === 'A'
        ? { competitorAId: userId, seedA: seed }
        : { competitorBId: userId, seedB: seed },
  });
}

/** Keep `Ranking` in step with the bracket: who is alive, who went out where. */
async function updateRankingsForMatch(
  client: DbClient,
  match: Match,
  outcome: MatchOutcome,
  stage: RoundStage,
): Promise<void> {
  if (outcome.winnerId) {
    await client.ranking.updateMany({
      where: { tournamentId: match.tournamentId, userId: outcome.winnerId },
      data: { currentStage: stage },
    });
  }
  // The third-place play-off is not an elimination — both players already lost
  // their semi-final, and marking the loser out "at THIRD_PLACE" would overwrite
  // where they actually went out.
  if (outcome.loserId && stage !== 'THIRD_PLACE') {
    await client.ranking.updateMany({
      where: { tournamentId: match.tournamentId, userId: outcome.loserId },
      data: { currentStage: stage, eliminatedAtStage: stage },
    });
  }
}

/**
 * Decide every match in a stage that can be decided.
 * Safe to call repeatedly; only undecided, decidable matches change.
 */
export async function advanceStage(
  client: DbClient,
  tournamentId: string,
  stage: RoundStage,
  config: TournamentConfig,
): Promise<MatchDecision[]> {
  const round = await client.round.findFirst({
    where: { tournamentId, stage },
    select: { id: true },
  });
  if (!round) {
    throw new NotFoundError(`tournament ${tournamentId} has no ${stage} round`);
  }

  const matches = await client.match.findMany({
    where: { roundId: round.id },
    orderBy: { bracketPosition: 'asc' },
    select: { id: true },
  });

  const decisions: MatchDecision[] = [];
  for (const match of matches) {
    decisions.push(await decideAndPropagate(client, match.id, config));
  }
  return decisions;
}

/**
 * Resolve every match whose result needs no submissions — byes and the voids
 * they cascade into. Run once after bracket generation so a competitor with a
 * bye is already sitting in the next round before anybody plays.
 *
 * Iterates to a fixed point because resolving one bye can make the next round's
 * match resolvable too (possible when a bracket is deliberately oversized).
 */
export async function resolveDeterminedMatches(
  client: DbClient,
  tournamentId: string,
  config: TournamentConfig,
): Promise<MatchDecision[]> {
  const rounds = await client.round.findMany({
    where: { tournamentId, type: 'KNOCKOUT' },
    orderBy: { sequence: 'asc' },
    select: { id: true, stage: true },
  });

  const applied: MatchDecision[] = [];
  // Bounded by the number of rounds: each pass can only resolve byes one round
  // deeper, so the loop cannot spin.
  for (let pass = 0; pass < rounds.length + 1; pass++) {
    let changedThisPass = 0;

    for (const round of rounds) {
      const matches = await client.match.findMany({
        where: { roundId: round.id, status: { not: 'DECIDED' } },
        orderBy: { bracketPosition: 'asc' },
        select: { id: true, competitorAId: true, competitorBId: true },
      });

      for (const match of matches) {
        // Only touch matches that cannot need a submission: at most one
        // competitor. A full pairing is decided by scores, not here.
        if (match.competitorAId && match.competitorBId) continue;
        const decision = await decideAndPropagate(client, match.id, config);
        if (decision.changed) {
          applied.push(decision);
          changedThisPass++;
        }
      }
    }

    if (changedThisPass === 0) break;
  }

  return applied;
}

/**
 * Decide any open SUDDEN_DEATH matches and write their results onto the matches
 * they settle.
 *
 * Sudden-death rounds sit OUTSIDE the main stage list (`knockoutStages` never
 * yields SUDDEN_DEATH), so `advanceStage` never visits them. Without this pass a
 * finished sudden-death challenge would score but never unstick the bracket.
 *
 * Safe to call on every progress pass: matches already decided are skipped.
 */
export async function resolveSuddenDeathMatches(
  client: DbClient,
  tournamentId: string,
  config: TournamentConfig,
): Promise<MatchDecision[]> {
  const rounds = await client.round.findMany({
    where: { tournamentId, stage: 'SUDDEN_DEATH' },
    select: { id: true },
  });
  if (rounds.length === 0) return [];

  const matches = await client.match.findMany({
    where: {
      roundId: { in: rounds.map((round) => round.id) },
      status: { not: 'DECIDED' },
    },
    orderBy: { bracketPosition: 'asc' },
    select: { id: true },
  });

  const decisions: MatchDecision[] = [];
  for (const match of matches) {
    decisions.push(await decideAndPropagate(client, match.id, config));
  }
  return decisions;
}

export interface RoundCompletion {
  stage: RoundStage;
  roundId: string;
  total: number;
  decided: number;
  /** Matches stuck on an unresolved tie (need sudden death). */
  tied: number;
  complete: boolean;
}

/** Is every match in this stage decided? The trigger for round progression. */
export async function getRoundCompletion(
  tournamentId: string,
  stage: RoundStage,
  client: DbClient = db,
): Promise<RoundCompletion> {
  const round = await client.round.findFirst({
    where: { tournamentId, stage },
    select: { id: true },
  });
  if (!round) {
    throw new NotFoundError(`tournament ${tournamentId} has no ${stage} round`);
  }

  const matches = await client.match.findMany({
    where: { roundId: round.id },
    select: { status: true, tieUnresolved: true },
  });

  const decided = matches.filter((m) => m.status === 'DECIDED').length;
  const tied = matches.filter((m) => m.tieUnresolved).length;

  return {
    stage,
    roundId: round.id,
    total: matches.length,
    decided,
    tied,
    complete: matches.length > 0 && decided === matches.length,
  };
}

/**
 * Final placements, written once the bracket is exhausted.
 *
 * 1st/2nd come from the final, 3rd/4th from the third-place play-off when it is
 * enabled. Beyond that, placement is by the stage a competitor went out in —
 * everyone eliminated in the same round shares a placement band, which is the
 * standard single-elimination convention and avoids inventing an order that the
 * bracket never established.
 */
export async function assignFinalPlacements(
  client: DbClient,
  tournamentId: string,
): Promise<{ championId: string | null; runnerUpId: string | null }> {
  const rounds = await client.round.findMany({
    where: { tournamentId, type: 'KNOCKOUT' },
    orderBy: { sequence: 'asc' },
    select: { id: true, stage: true, sequence: true },
  });

  const finalRound = rounds.find((r) => r.stage === 'FINAL');
  const thirdRound = rounds.find((r) => r.stage === 'THIRD_PLACE');

  const finalMatch = finalRound
    ? await client.match.findFirst({ where: { roundId: finalRound.id } })
    : null;
  const thirdMatch = thirdRound
    ? await client.match.findFirst({ where: { roundId: thirdRound.id } })
    : null;

  const placements = new Map<string, number>();
  if (finalMatch?.winnerId) placements.set(finalMatch.winnerId, 1);
  if (finalMatch?.loserId) placements.set(finalMatch.loserId, 2);
  if (thirdMatch?.winnerId) placements.set(thirdMatch.winnerId, 3);
  if (thirdMatch?.loserId) placements.set(thirdMatch.loserId, 4);

  // Placement band for everyone else: eliminated later = better placement.
  // A stage where `n` competitors go out occupies the band starting one past
  // however many survived it.
  // SUDDEN_DEATH is not a stage anyone is eliminated *at* — it settles a tie
  // belonging to another stage — so it must not occupy a placement band.
  const stageOrder = rounds
    .map((r) => r.stage)
    .filter((stage) => stage !== 'SUDDEN_DEATH');
  const eliminated = await client.ranking.findMany({
    where: {
      tournamentId,
      qualified: true,
      eliminatedAtStage: { not: null },
    },
    select: { userId: true, eliminatedAtStage: true },
  });

  const bandStart = new Map<RoundStage, number>();
  for (const stage of stageOrder) {
    if (stage === 'THIRD_PLACE') continue;
    // Each match in a stage produces exactly one survivor, so the number of
    // matches IS the number of competitors who outlived that stage. Everyone
    // knocked out here therefore starts one place below them: QF (4 matches)
    // -> band 5, SF (2) -> 3, FINAL (1) -> 2.
    const survivors = await client.match.count({
      where: { tournamentId, round: { stage } },
    });
    bandStart.set(stage, survivors + 1);
  }

  for (const row of eliminated) {
    if (placements.has(row.userId)) continue;
    const stage = row.eliminatedAtStage;
    if (!stage) continue;
    const band = bandStart.get(stage);
    if (band) placements.set(row.userId, band);
  }

  for (const [userId, placement] of placements) {
    await client.ranking.updateMany({
      where: { tournamentId, userId },
      data: { placement },
    });
  }

  return {
    championId: finalMatch?.winnerId ?? null,
    runnerUpId: finalMatch?.loserId ?? null,
  };
}
