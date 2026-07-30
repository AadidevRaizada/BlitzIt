import type {
  Prisma,
  TournamentEnvironment,
  User,
} from '@/generated/prisma/client';
import { canAccessTestEnvironment } from '@/server/modules/auth/roles';
import { NotFoundError } from '@/lib/errors';

/**
 * Environment scoping — the ONE definition of "whose world is this?".
 *
 * D33 established that a fact with two definitions eventually has two different
 * answers, and that a page rendering both is how you find out. This module
 * exists so "which tournaments may this viewer see?" is defined exactly once.
 * The failure mode being designed out is not exotic: it is fifteen query sites
 * each remembering to add `environment: 'PRODUCTION'`, and the sixteenth — added
 * six months from now by someone who has never read this file — forgetting.
 *
 * ## Two mechanisms, for two different shapes of read
 *
 * 1. **Aggregate / discovery reads** — public tournament lists, leaderboards,
 *    Hall of Fame, rankings, statistics, profiles, spectator selection. These
 *    return MANY tournaments and must filter. They take a required
 *    `EnvironmentScope` and compose {@link tournamentEnvironmentFilter}.
 *
 * 2. **Entity reads** — one tournament, bracket, arena, live snapshot,
 *    registration. These already know their subject; filtering is the wrong
 *    verb. They call {@link assertTournamentVisible}, which 404s rather than
 *    403s, because "you are not allowed to see this test tournament" tells a
 *    production user that it exists.
 *
 * ## What deliberately needs NEITHER
 *
 * A competitor's own data — dashboard, Mission Control, my results, my
 * submissions, notifications — is already scoped by `userId`, and a user can
 * only ever hold rows in an environment they were allowed to enter. Adding an
 * environment filter there would be redundant at best, and at worst would blank
 * a tester's own dashboard. The guard that makes this true is on the way IN
 * (registration), not on the way out.
 *
 * ## Why the scope is required and single-valued
 *
 * There is no `ALL`. Production and test data must never appear in one list, so
 * a merged scope is not a feature this type should be able to express. Admin
 * surfaces, which legitimately browse both, are already behind `requireAdmin`
 * and take an explicit optional environment filter instead — so the only way to
 * see both is a deliberate admin read, never an accidental public one.
 *
 * Callers must PASS a scope; there is no default. A default is a decision made
 * once by this file on behalf of every future surface, and the whole point is
 * that each surface decides visibly. A new page cannot compile without saying
 * which world it belongs to.
 */

/** The single environment a non-admin surface reads from. */
export type EnvironmentScope = TournamentEnvironment;

export const PRODUCTION: EnvironmentScope = 'PRODUCTION';
export const TEST: EnvironmentScope = 'TEST';

/**
 * The environment a viewer's TEST-capable surfaces read from, or null when they
 * have none.
 *
 * Note what this does NOT do: it does not switch a tester's *production* pages
 * to test data. A tester on `/leaderboard` sees the production leaderboard,
 * exactly as any competitor would — that is what "the same competitor UI" means.
 * The test world lives at its own routes, reading the same components with this
 * scope. Nothing about a tester's production experience changes.
 */
export function testScopeFor(
  user: Pick<User, 'role'> | null | undefined,
): EnvironmentScope | null {
  return canAccessTestEnvironment(user) ? TEST : null;
}

/**
 * The Prisma fragment restricting a query to one environment.
 *
 * Returned as a fragment rather than applied by a wrapper so it composes with
 * the visibility and archival filters each surface already has, and so it is
 * visible at the call site. This mirrors `competitionEligibleRegistrationWhere`,
 * which is the same pattern for the same reason.
 */
export function tournamentEnvironmentFilter(
  scope: EnvironmentScope,
): Pick<Prisma.TournamentWhereInput, 'environment'> {
  return { environment: scope };
}

/**
 * The same restriction, one level down, for models that reach a tournament
 * through a relation (`Ranking`, `HallOfFame`, `Registration`, `Submission`).
 *
 * Exists so those call sites cannot invent their own spelling of the nested
 * filter — the shape `{ tournament: { environment } }` appears in one place.
 */
export function nestedTournamentEnvironmentFilter(scope: EnvironmentScope): {
  tournament: Pick<Prisma.TournamentWhereInput, 'environment'>;
} {
  return { tournament: tournamentEnvironmentFilter(scope) };
}

/**
 * Refuse an entity read whose subject is outside the viewer's reach.
 *
 * Throws `NotFoundError`, never `ForbiddenError`, and that is the whole point: a
 * 403 confirms the thing exists. "A production user should never even know Test
 * Tournaments exist" is only true if a test tournament is indistinguishable from
 * a typo in the URL.
 */
export function assertTournamentVisible(
  viewer: Pick<User, 'role'> | null | undefined,
  tournament: Pick<Tournamentish, 'environment'>,
): void {
  if (tournament.environment === 'PRODUCTION') return;
  if (canAccessTestEnvironment(viewer)) return;
  throw new NotFoundError('That tournament does not exist');
}

/** The narrowest shape {@link assertTournamentVisible} needs. */
interface Tournamentish {
  environment: TournamentEnvironment;
}

/**
 * Non-throwing form, for surfaces that render an empty state rather than a 404
 * (the landing page picking a spectator tournament, for instance).
 */
export function isTournamentVisibleTo(
  viewer: Pick<User, 'role'> | null | undefined,
  tournament: Pick<Tournamentish, 'environment'>,
): boolean {
  return (
    tournament.environment === 'PRODUCTION' || canAccessTestEnvironment(viewer)
  );
}
