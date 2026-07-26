import 'server-only';
import { Prisma, type Tournament } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { NotFoundError } from '@/lib/errors';

/**
 * Dynamic prize pool (E9.2).
 *
 * The stored `Tournament.prizePoolMinor` is a persisted read model. Every
 * mutation that changes eligible entries recomputes it inside the same
 * transaction, and every surface reads this DTO rather than redoing money math.
 */

type PrizePoolSource = Pick<
  Tournament,
  | 'id'
  | 'passPriceMinor'
  | 'currency'
  | 'basePrizePoolMinor'
  | 'prizePerRegistrationMinor'
  | 'sponsorContributionMinor'
  | 'bonusContributionMinor'
  | 'firstPrizeCapMinor'
  | 'prizePoolMinor'
  | 'prizeDistribution'
>;

export interface PrizeAllocation {
  key: string;
  label: string;
  amountMinor: number;
  capped: boolean;
}

export interface PrizePoolBreakdown {
  tournamentId: string;
  currency: string;
  paidEntries: number;
  entryContributionMinor: number;
  basePrizePoolMinor: number;
  sponsorContributionMinor: number;
  bonusContributionMinor: number;
  guaranteedFloorMinor: number;
  computedPrizePoolMinor: number;
  prizePoolMinor: number;
  firstPrizeCapMinor: number;
  prizeDistribution: unknown;
  allocations: PrizeAllocation[];
}

export type PrizePoolDisplay = PrizePoolBreakdown;

export async function countPaidEntries(
  tournamentId: string,
  client: DbClient = db,
): Promise<number> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { passPriceMinor: true },
  });
  if (!tournament) throw new NotFoundError('Tournament not found');

  if (tournament.passPriceMinor <= 0) {
    return client.registration.count({
      where: { tournamentId, status: 'ACTIVE' },
    });
  }

  return client.registration.count({
    where: {
      tournamentId,
      status: 'ACTIVE',
      payment: { status: 'PAID' },
    },
  });
}

export function derivePrizePoolBreakdown(
  tournament: PrizePoolSource,
  paidEntries: number,
): PrizePoolBreakdown {
  const entryContributionMinor =
    paidEntries * tournament.prizePerRegistrationMinor;
  const contributedMinor =
    entryContributionMinor +
    tournament.sponsorContributionMinor +
    tournament.bonusContributionMinor;
  const computedPrizePoolMinor = Math.max(
    tournament.basePrizePoolMinor,
    contributedMinor,
  );

  return {
    tournamentId: tournament.id,
    currency: tournament.currency,
    paidEntries,
    entryContributionMinor,
    basePrizePoolMinor: tournament.basePrizePoolMinor,
    sponsorContributionMinor: tournament.sponsorContributionMinor,
    bonusContributionMinor: tournament.bonusContributionMinor,
    guaranteedFloorMinor: tournament.basePrizePoolMinor,
    computedPrizePoolMinor,
    prizePoolMinor: computedPrizePoolMinor,
    firstPrizeCapMinor: tournament.firstPrizeCapMinor,
    prizeDistribution: tournament.prizeDistribution,
    allocations: derivePrizeAllocations(
      computedPrizePoolMinor,
      tournament.firstPrizeCapMinor,
      tournament.prizeDistribution,
    ),
  };
}

export async function getPrizePoolDisplay(
  tournamentId: string,
  client: DbClient = db,
): Promise<PrizePoolDisplay> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: prizePoolSelect,
  });
  if (!tournament) throw new NotFoundError('Tournament not found');
  return derivePrizePoolBreakdown(
    tournament,
    await countPaidEntries(tournamentId, client),
  );
}

export async function recomputePrizePool(
  tournamentId: string,
  client: Prisma.TransactionClient,
): Promise<PrizePoolBreakdown> {
  await client.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`prize-pool:${tournamentId}`}))`,
  );

  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: prizePoolSelect,
  });
  if (!tournament) throw new NotFoundError('Tournament not found');

  const breakdown = derivePrizePoolBreakdown(
    tournament,
    await countPaidEntries(tournamentId, client),
  );

  await client.tournament.update({
    where: { id: tournamentId },
    data: { prizePoolMinor: breakdown.prizePoolMinor },
  });

  return breakdown;
}

export const prizePoolSelect = {
  id: true,
  passPriceMinor: true,
  currency: true,
  basePrizePoolMinor: true,
  prizePerRegistrationMinor: true,
  sponsorContributionMinor: true,
  bonusContributionMinor: true,
  firstPrizeCapMinor: true,
  prizePoolMinor: true,
  prizeDistribution: true,
} satisfies Prisma.TournamentSelect;

function derivePrizeAllocations(
  totalMinor: number,
  firstPrizeCapMinor: number,
  distribution: unknown,
): PrizeAllocation[] {
  const entries = distributionEntries(distribution);
  if (entries.length === 0) {
    const amountMinor = Math.min(totalMinor, firstPrizeCapMinor);
    return [
      {
        key: 'first',
        label: 'First prize',
        amountMinor,
        capped: amountMinor < totalMinor,
      },
    ];
  }

  return entries.map(([key, share], index) => {
    const rawAmount = Math.floor(totalMinor * share);
    const capped = index === 0 && rawAmount > firstPrizeCapMinor;
    return {
      key,
      label: allocationLabel(key, index),
      amountMinor: capped ? firstPrizeCapMinor : rawAmount,
      capped,
    };
  });
}

function distributionEntries(distribution: unknown): Array<[string, number]> {
  if (typeof distribution !== 'object' || distribution === null) return [];
  if (Array.isArray(distribution)) return [];

  return Object.entries(distribution)
    .map(([key, value]): [string, number] | null => {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      return [key, numeric > 1 ? numeric / 100 : numeric];
    })
    .filter((entry): entry is [string, number] => entry !== null);
}

function allocationLabel(key: string, index: number): string {
  if (key.toLowerCase().includes('first') || key === '1') return 'First prize';
  if (key.toLowerCase().includes('second') || key === '2') {
    return 'Second prize';
  }
  if (key.toLowerCase().includes('third') || key === '3') return 'Third prize';
  return index === 0 ? 'First prize' : `Prize ${index + 1}`;
}
