import type { Prisma } from '@/generated/prisma/client';

/**
 * Byes, in one place.
 *
 * A bye is NOT a participant. There is no phantom user, no placeholder row, no
 * `isBye` column. A bye is an ordinary `Match` with an empty competitor slot —
 * `competitorAId` and `seedA` both null — which `decideMatch` resolves the
 * instant the bracket is generated, inside the same transaction. Nothing
 * downstream has to be taught what a bye is in order to be *correct*: the match
 * is already DECIDED with a winner before any round opens, so evaluation,
 * submission, timers, sudden death and the queue never see it.
 *
 * That is the whole architecture, and it is why this file is small. What lives
 * here is only the stuff that needs a bye to be *legible* rather than merely
 * correct: counting matches a human is expected to watch, and labelling slots
 * that will never be filled. Those two questions were previously answered
 * inline, differently, in five places.
 *
 * ## The predicate
 *
 * A structurally-resolved match is one nobody plays. Two flavours:
 *
 *   - BYE   — one slot empty. Winner set, `winReason = BYE`.
 *   - VOID  — both slots empty. No winner, no reason.
 *
 * Both are DECIDED at generation time. A match decided any other way always
 * carries a non-null `winReason`, so "DECIDED and (BYE or no reason)" catches
 * exactly these two and nothing else. Crucially it does NOT catch an upstream
 * match still waiting for its feeders — those have empty slots too, but they
 * are PENDING, not DECIDED.
 *
 * VOID matches cannot arise from automatic sizing: `autoBracketSize` picks the
 * smallest bracket that fits the field, so more than half the seeds are always
 * occupied, and every first-round pair contains a seed from the top half. They
 * remain reachable when an operator explicitly oversizes a draw, which stays
 * supported — hence the predicate covers both.
 */
export const STRUCTURAL_MATCH_FILTER = {
  status: 'DECIDED',
  OR: [{ winReason: 'BYE' }, { winReason: null }],
} satisfies Prisma.MatchWhereInput;

/**
 * Was this match handed to someone rather than played?
 *
 * The in-memory twin of `STRUCTURAL_MATCH_FILTER`, for rows already loaded.
 * Keep the two in step — they answer the same question in different places.
 */
export function isStructuralMatch(match: {
  status: string;
  winReason: string | null;
}): boolean {
  return (
    match.status === 'DECIDED' &&
    (match.winReason === 'BYE' || match.winReason === null)
  );
}

/**
 * Will this slot ever hold a competitor?
 *
 * A first-round slot with no seed is empty forever — no upstream match feeds
 * it. A later-round slot with no competitor is merely waiting. The bracket UI
 * showed "TBD" for both, which told a spectator to expect a name that was never
 * coming and made a top seed's bye look like a scheduling error.
 *
 * `hasFeeder` is what distinguishes them: it is false only for the first
 * knockout round, where seeds are assigned directly rather than won.
 */
export function isSlotPermanentlyEmpty(slot: {
  competitorId: string | null;
  seed: number | null;
  hasFeeder: boolean;
}): boolean {
  return slot.competitorId === null && slot.seed === null && !slot.hasFeeder;
}
