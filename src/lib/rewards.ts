/**
 * The published reward structure for a Circuit tournament.
 *
 * Deliberately fixed copy, and deliberately not derived from `prizePool`. The
 * stored pool is still calculated, settled, and paid out — it remains the
 * system of record for admin and payouts — but it is not what a public surface
 * shows. A pool that visibly grows with each paid entry frames the event as a
 * raffle rather than a competition, and it tells a competitor nothing about
 * what winning is worth to them.
 *
 * These live in `lib` rather than beside one page because three public
 * surfaces quote them (the tournament page, the tournament cards, the season
 * ledger) and they must never drift apart. Changing a figure here changes it
 * everywhere it is promised.
 */

/**
 * The headline every public tournament surface leads with, and its supporting
 * line. One definition because the promise has to be word-identical on the
 * card, the ledger, and the tournament page — three near-copies is how a
 * marketing claim quietly becomes three different claims.
 *
 * The multiple is stated as a ceiling ("up to") deliberately: it is the
 * champion's ₹2,000 against the ₹99 default entry. A tournament priced
 * differently moves the real multiple, so this copy claims a maximum rather
 * than a rate.
 */
export const REWARD_HEADLINE = 'Compete for up to 20× your entry fee.';
export const REWARD_SUPPORT =
  'Cash rewards • Internships • Client projects • Accelerator seats';
/** The bare multiple, for stat slots too narrow for the full sentence. */
export const REWARD_MULTIPLE = '20×';

export type CashReward = {
  /** Rendered as-is; the medal is part of the published presentation. */
  medal: string;
  place: string;
  award: string;
};

export const CASH_REWARDS: readonly CashReward[] = [
  { medal: '🥇', place: 'Champion', award: '₹2,000' },
  { medal: '🥈', place: 'Runner-up', award: '₹1,200' },
  { medal: '🥉', place: 'Third place', award: '₹800' },
  { medal: '🏅', place: '4th–8th place', award: 'Entry fee refunded' },
];

export const CAREER_REWARDS: ReadonlyArray<{ tier: string; award: string }> = [
  {
    tier: 'Top 32',
    award: 'Official Circuit certificate for your portfolio and resume',
  },
  {
    tier: 'Top 8',
    award: 'Internship opportunities with DevHub and partner companies',
  },
  { tier: 'Top 8', award: 'Priority consideration for real client projects' },
  {
    tier: 'Top 4',
    award: "Free seat in 0to1, DevHub's Internship-to-Startup Accelerator",
  },
];
