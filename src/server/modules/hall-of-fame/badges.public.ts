/**
 * Badge catalogue and award rules — pure (E8.4).
 *
 * The catalogue is code, not data an operator maintains: a badge's meaning is
 * part of the product, and one that could be renamed or re-scoped after it was
 * awarded would rewrite history for whoever already holds it. The rows in
 * `Badge` are a projection of this list, synchronised at award time.
 *
 * Award rules are a pure function of a finished tournament's placements, so the
 * same standings always produce the same badges — recomputable, auditable, and
 * testable without a database.
 */

export const BADGE_SLUGS = [
  'champion',
  'runner-up',
  'semi-finalist',
  'third-place',
  'qualifier',
] as const;

export type BadgeSlug = (typeof BADGE_SLUGS)[number];

export interface BadgeDefinition {
  slug: BadgeSlug;
  name: string;
  description: string;
}

export const BADGE_CATALOGUE: Readonly<Record<BadgeSlug, BadgeDefinition>> = {
  champion: {
    slug: 'champion',
    name: 'Champion',
    description: 'Won a Blitz It tournament outright.',
  },
  'runner-up': {
    slug: 'runner-up',
    name: 'Runner-up',
    description: 'Reached the final.',
  },
  'third-place': {
    slug: 'third-place',
    name: 'Third place',
    description: 'Won the third-place play-off.',
  },
  'semi-finalist': {
    slug: 'semi-finalist',
    name: 'Semi-finalist',
    description: 'Reached the last four.',
  },
  qualifier: {
    slug: 'qualifier',
    name: 'Qualifier',
    description: 'Came through the qualifiers into the bracket.',
  },
};

/** One competitor's finishing position, as the standings record it. */
export interface PlacementInput {
  userId: string;
  /** 1 = champion. Null for anyone who did not reach the bracket. */
  placement: number | null;
  qualified: boolean;
}

export interface BadgeAward {
  userId: string;
  slug: BadgeSlug;
}

/**
 * Which badges a finished tournament awards.
 *
 * Cumulative by design: a champion also holds `semi-finalist` and `qualifier`,
 * because both are true and a profile that showed only the highest badge would
 * make a champion look like they had never qualified for anything. Duplicate
 * awards are impossible anyway — `UserBadge` is unique per (user, badge,
 * tournament).
 *
 * `semi-finalist` is placement ≤ 4 rather than "played in the SF round": with
 * the third-place play-off disabled (D6) the losing semi-finalists share
 * placement 3, and keying off the round would need the bracket rather than the
 * standings.
 */
export function awardsForPlacements(
  placements: readonly PlacementInput[],
): BadgeAward[] {
  const awards: BadgeAward[] = [];

  for (const entry of placements) {
    if (entry.qualified) {
      awards.push({ userId: entry.userId, slug: 'qualifier' });
    }
    if (entry.placement === null) continue;

    if (entry.placement <= 4) {
      awards.push({ userId: entry.userId, slug: 'semi-finalist' });
    }
    if (entry.placement === 3) {
      awards.push({ userId: entry.userId, slug: 'third-place' });
    }
    if (entry.placement === 2) {
      awards.push({ userId: entry.userId, slug: 'runner-up' });
    }
    if (entry.placement === 1) {
      awards.push({ userId: entry.userId, slug: 'champion' });
    }
  }

  return awards;
}

/** The podium a Hall of Fame entry records. */
export interface Podium {
  championId: string | null;
  runnerUpId: string | null;
  thirdPlaceId: string | null;
}

/**
 * Read the podium off the standings.
 *
 * Third place is only recorded when exactly one competitor holds placement 3.
 * Without the play-off (D6) both losing semi-finalists share it, and naming one
 * of them "third" would be an arbitrary choice presented as a result.
 */
export function podiumFromPlacements(
  placements: readonly PlacementInput[],
): Podium {
  const at = (place: number) =>
    placements.filter((entry) => entry.placement === place);

  const third = at(3);
  return {
    championId: at(1)[0]?.userId ?? null,
    runnerUpId: at(2)[0]?.userId ?? null,
    thirdPlaceId: third.length === 1 ? (third[0]?.userId ?? null) : null,
  };
}
