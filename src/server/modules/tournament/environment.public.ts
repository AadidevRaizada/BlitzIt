import type {
  Prisma,
  TournamentEnvironment,
  User,
} from '@/generated/prisma/client';
import { canAccessTestEnvironment } from '@/server/modules/auth/roles';
import { ForbiddenError, NotFoundError } from '@/lib/errors';

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
 * The environment a viewer *competes in* — the scope for surfaces that offer
 * something to enter or show what they have entered: the dashboard, Mission
 * Control, tournament discovery.
 *
 * A tester's entire competitive life happens in TEST, so their dashboard must
 * offer test tournaments; scoping it to PRODUCTION would hand them an empty
 * Mission Control and no way to register, which is precisely the experience this
 * feature exists to provide. Everybody else competes in PRODUCTION.
 *
 * Admins are NOT testers by this rule, deliberately. An admin is a production
 * operator who happens to be able to see the test world; their own dashboard
 * stays production, and they reach test surfaces by asking for them. Silently
 * flipping every admin's dashboard to test data the moment a test tournament
 * existed would be a surprising, and eventually a dangerous, default.
 */
export function competitorScopeFor(
  user: Pick<User, 'role'> | null | undefined,
): EnvironmentScope {
  return user?.role === 'TEST' ? TEST : PRODUCTION;
}

/**
 * Read an environment out of a URL parameter, defaulting to PRODUCTION.
 *
 * Case-insensitive and total: anything unrecognised is PRODUCTION, never an
 * error. A malformed `?env=` must not be able to produce a 500 on an operator's
 * dashboard, and — more importantly — must never fall through to TEST.
 *
 * This performs NO authorisation. It parses; the caller still gates. Every
 * current caller is behind `requireAdmin` or `requireTestAccess`, so a
 * production user appending `?env=test` to an admin URL is bounced before this
 * is ever reached.
 */
export function parseEnvironmentParam(
  value: string | undefined | null,
): EnvironmentScope {
  return value?.toUpperCase() === 'TEST' ? TEST : PRODUCTION;
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
 * May this user ENTER a tournament in this environment?
 *
 * This is the guard that makes every competitor-owned read safe without an
 * environment filter of its own. The dashboard, Mission Control, results,
 * submissions and notifications are all scoped by `userId` and none of them
 * checks an environment — which is only correct because a user can never have
 * acquired a row in the wrong world in the first place. That invariant is
 * established here, on the way in, and nowhere else.
 *
 * The rule, and why each half matters:
 *
 * | Actor | May enter | Why |
 * |---|---|---|
 * | bot | TEST only | Bots are lifecycle participants, never competitors |
 * | TEST | TEST only | A tester's results must never reach a production record |
 * | USER | PRODUCTION only | Test tournaments are not theirs to discover |
 * | ADMIN | either | Operators legitimately drive both worlds |
 *
 * Both directions are enforced, not just the obvious one. Blocking a production
 * user from a test tournament without also blocking a tester from a production
 * one would leave the leak wide open in the direction that actually corrupts the
 * permanent record.
 *
 * Throws `NotFoundError` for the same reason as `assertTournamentVisible`: a
 * competitor who cannot see a tournament must not learn of it from the shape of
 * the refusal.
 */
export function assertMayEnterEnvironment(
  user: Pick<User, 'role' | 'isBot'>,
  environment: TournamentEnvironment,
): void {
  if (user.isBot) {
    if (environment === 'TEST') return;
    // Not a NotFoundError: nothing is being hidden from a bot, and this one is
    // an internal programming error worth reading in a log.
    throw new ForbiddenError(
      'Bots may only take part in test tournaments (D35)',
    );
  }
  if (user.role === 'ADMIN') return;
  if (user.role === 'TEST') {
    if (environment === 'TEST') return;
    throw new ForbiddenError(
      'Test accounts may only enter test tournaments; their results must never reach the production record',
    );
  }
  if (environment === 'PRODUCTION') return;
  throw new NotFoundError('That tournament does not exist');
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
