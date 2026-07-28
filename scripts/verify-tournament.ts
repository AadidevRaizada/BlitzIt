import './load-env';
import {
  allowedTransitions,
  canTransition,
  forwardTransition,
  fromLifecycleState,
  InvalidTransitionError,
  knockoutStages,
  nextState,
  TERMINAL_STATES,
  toLifecycleState,
  TOURNAMENT_TRANSITIONS,
  type BracketShape,
  type LifecycleState,
  type TournamentTransition,
} from '../src/server/modules/tournament/lifecycle';
import {
  autoBracketSize,
  decideBracketSizing,
  isBracketSize,
  stagesForBracketSize,
  SUPPORTED_BRACKET_SIZES,
} from '../src/server/modules/tournament/config.public';
import { buildBracketPlan } from '../src/server/modules/tournament/bracket';
import { resolveTournamentConfig } from '../src/server/modules/tournament/config';

/**
 * Epic E3 — lifecycle state machine acceptance.
 *
 * PURE checks only: no database. Proves that every documented transition
 * exists, that every undocumented one is refused, and that configuration
 * resolves the way the docs claim.
 *
 * Run: npm run verify:tournament
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

/** Assert a transition is refused, and refused with the right error type. */
function checkRejected(
  label: string,
  from: LifecycleState,
  transition: TournamentTransition,
  shape?: BracketShape,
) {
  let rejected = false;
  let wrongError = '';
  try {
    nextState(from, transition, shape);
  } catch (error) {
    rejected = true;
    if (!(error instanceof InvalidTransitionError)) {
      wrongError = `threw ${(error as Error).name}, not InvalidTransitionError`;
    }
  }
  check(label, rejected && wrongError === '', wrongError || 'was accepted');
}

const SHAPE_8: BracketShape = { bracketSize: 8, thirdPlaceEnabled: true };
const SHAPE_8_NO_THIRD: BracketShape = {
  bracketSize: 8,
  thirdPlaceEnabled: false,
};
const SHAPE_64: BracketShape = { bracketSize: 64, thirdPlaceEnabled: true };

function main() {
  // ---- 1. The documented happy path, end to end ----
  {
    const path: Array<[LifecycleState, TournamentTransition, LifecycleState]> =
      [
        ['DRAFT', 'PUBLISH', 'PUBLISHED'],
        ['PUBLISHED', 'OPEN_REGISTRATION', 'REGISTRATION_OPEN'],
        ['REGISTRATION_OPEN', 'CLOSE_REGISTRATION', 'REGISTRATION_CLOSED'],
        ['REGISTRATION_CLOSED', 'START_SIMULATION', 'SIMULATION'],
        ['SIMULATION', 'CLOSE_SIMULATION', 'SEEDING'],
        ['SEEDING', 'GENERATE_BRACKET', 'BRACKET_GENERATED'],
        ['BRACKET_GENERATED', 'START_KNOCKOUT', 'LIVE:R64'],
        ['LIVE:R64', 'ADVANCE_STAGE', 'LIVE:R32'],
        ['LIVE:R32', 'ADVANCE_STAGE', 'LIVE:R16'],
        ['LIVE:R16', 'ADVANCE_STAGE', 'LIVE:QF'],
        ['LIVE:QF', 'ADVANCE_STAGE', 'LIVE:SF'],
        ['LIVE:SF', 'ADVANCE_STAGE', 'LIVE:THIRD_PLACE'],
        ['LIVE:THIRD_PLACE', 'ADVANCE_STAGE', 'LIVE:FINAL'],
        ['LIVE:FINAL', 'COMPLETE', 'COMPLETED'],
      ];

    for (const [from, transition, expected] of path) {
      const actual = nextState(from, transition, SHAPE_64);
      check(
        `${from} --${transition}--> ${expected}`,
        actual === expected,
        `got ${actual}`,
      );
    }
  }

  // ---- 2. Every invalid transition must fail ----
  {
    // The exhaustive matrix: for each state, exactly the documented set is legal.
    const legalByState: Record<string, TournamentTransition[]> = {
      DRAFT: ['PUBLISH', 'CANCEL'],
      PUBLISHED: ['OPEN_REGISTRATION', 'CANCEL'],
      REGISTRATION_OPEN: ['CLOSE_REGISTRATION', 'CANCEL'],
      REGISTRATION_CLOSED: ['START_SIMULATION', 'CANCEL'],
      SIMULATION: ['CLOSE_SIMULATION', 'CANCEL'],
      SEEDING: ['GENERATE_BRACKET', 'CANCEL'],
      BRACKET_GENERATED: ['START_KNOCKOUT', 'CANCEL'],
      'LIVE:QF': ['ADVANCE_STAGE', 'CANCEL'],
      'LIVE:SF': ['ADVANCE_STAGE', 'CANCEL'],
      'LIVE:THIRD_PLACE': ['ADVANCE_STAGE', 'CANCEL'],
      'LIVE:FINAL': ['COMPLETE', 'CANCEL'],
      COMPLETED: [],
      CANCELLED: [],
    };

    for (const [state, legal] of Object.entries(legalByState)) {
      const from = state as LifecycleState;
      const actual = allowedTransitions(from, SHAPE_8).sort();
      check(
        `${from}: exactly [${legal.slice().sort().join(', ')}] are legal`,
        JSON.stringify(actual) === JSON.stringify(legal.slice().sort()),
        `got [${actual.join(', ')}]`,
      );

      for (const transition of TOURNAMENT_TRANSITIONS) {
        if (legal.includes(transition)) continue;
        checkRejected(
          `${from} rejects ${transition}`,
          from,
          transition,
          SHAPE_8,
        );
      }
    }
  }

  // ---- 3. Skipping the lifecycle is impossible ----
  checkRejected(
    'DRAFT cannot jump straight to registration',
    'DRAFT',
    'OPEN_REGISTRATION',
  );
  checkRejected(
    'registration cannot skip simulation',
    'REGISTRATION_CLOSED',
    'GENERATE_BRACKET',
  );
  checkRejected(
    'a bracket cannot be generated before seeding',
    'SIMULATION',
    'GENERATE_BRACKET',
  );
  checkRejected(
    'the knockout cannot start before a bracket exists',
    'SEEDING',
    'START_KNOCKOUT',
  );
  checkRejected(
    'a tournament cannot complete mid-bracket',
    'LIVE:QF',
    'COMPLETE',
    SHAPE_8,
  );
  checkRejected(
    'the final does not advance to another stage',
    'LIVE:FINAL',
    'ADVANCE_STAGE',
    SHAPE_8,
  );
  checkRejected('a completed tournament is terminal', 'COMPLETED', 'CANCEL');
  checkRejected('a cancelled tournament is terminal', 'CANCELLED', 'PUBLISH');

  // ---- 4. Cancellation ----
  {
    const cancellable: LifecycleState[] = [
      'DRAFT',
      'PUBLISHED',
      'REGISTRATION_OPEN',
      'REGISTRATION_CLOSED',
      'SIMULATION',
      'SEEDING',
      'BRACKET_GENERATED',
      'LIVE:QF',
      'LIVE:FINAL',
    ];
    for (const state of cancellable) {
      check(
        `${state} can be cancelled`,
        nextState(state, 'CANCEL', SHAPE_8) === 'CANCELLED',
      );
    }
    for (const state of TERMINAL_STATES) {
      check(
        `${state} cannot be cancelled (terminal)`,
        !canTransition(state, 'CANCEL', SHAPE_8),
      );
    }
  }

  // ---- 5. Stage lists per bracket size (D6) ----
  {
    const expected: Record<number, string[]> = {
      8: ['QF', 'SF', 'THIRD_PLACE', 'FINAL'],
      16: ['R16', 'QF', 'SF', 'THIRD_PLACE', 'FINAL'],
      32: ['R32', 'R16', 'QF', 'SF', 'THIRD_PLACE', 'FINAL'],
      64: ['R64', 'R32', 'R16', 'QF', 'SF', 'THIRD_PLACE', 'FINAL'],
    };
    for (const size of SUPPORTED_BRACKET_SIZES) {
      const stages = stagesForBracketSize(size, true);
      check(
        `${size}-team bracket plays ${expected[size]!.join(' → ')}`,
        JSON.stringify(stages) === JSON.stringify(expected[size]),
        stages.join(','),
      );

      const without = stagesForBracketSize(size, false);
      check(
        `${size}-team bracket omits THIRD_PLACE when disabled`,
        !without.includes('THIRD_PLACE') &&
          without.length === expected[size]!.length - 1,
        without.join(','),
      );
    }
  }

  // ---- 6. Third place is genuinely optional ----
  check(
    'with third place OFF, SF advances straight to FINAL',
    nextState('LIVE:SF', 'ADVANCE_STAGE', SHAPE_8_NO_THIRD) === 'LIVE:FINAL',
  );
  check(
    'with third place ON, SF advances to THIRD_PLACE',
    nextState('LIVE:SF', 'ADVANCE_STAGE', SHAPE_8) === 'LIVE:THIRD_PLACE',
  );
  checkRejected(
    'THIRD_PLACE is not a stage when it is disabled',
    'LIVE:THIRD_PLACE',
    'ADVANCE_STAGE',
    SHAPE_8_NO_THIRD,
  );

  // ---- 7. An 8-team bracket starts at QF, not R64 ----
  check(
    'START_KNOCKOUT enters the first stage of THIS bracket (8 → QF)',
    nextState('BRACKET_GENERATED', 'START_KNOCKOUT', SHAPE_8) === 'LIVE:QF',
  );
  check(
    'START_KNOCKOUT enters the first stage of THIS bracket (64 → R64)',
    nextState('BRACKET_GENERATED', 'START_KNOCKOUT', SHAPE_64) === 'LIVE:R64',
  );
  checkRejected(
    'an 8-team bracket has no R16 stage to advance from',
    'LIVE:R16',
    'ADVANCE_STAGE',
    SHAPE_8,
  );

  // ---- 8. Knockout transitions require the bracket shape ----
  {
    let threw = false;
    try {
      nextState('BRACKET_GENERATED', 'START_KNOCKOUT');
    } catch {
      threw = true;
    }
    check('START_KNOCKOUT without a bracket shape is refused', threw);
  }

  // ---- 9. State encoding round-trips ----
  {
    const states: LifecycleState[] = [
      'DRAFT',
      'REGISTRATION_OPEN',
      'BRACKET_GENERATED',
      'LIVE:QF',
      'LIVE:THIRD_PLACE',
      'COMPLETED',
    ];
    for (const state of states) {
      const parts = fromLifecycleState(state);
      const back = toLifecycleState(parts.status, parts.currentStage);
      check(
        `${state} round-trips through the persisted columns`,
        back === state,
      );
    }

    let threw = false;
    try {
      toLifecycleState('LIVE', null);
    } catch {
      threw = true;
    }
    check('LIVE without a stage is rejected as inconsistent', threw);
  }

  // ---- 10. forwardTransition drives the schedule ----
  check(
    'forwardTransition ignores CANCEL',
    forwardTransition('DRAFT', SHAPE_8) === 'PUBLISH' &&
      forwardTransition('LIVE:FINAL', SHAPE_8) === 'COMPLETE',
  );
  check(
    'forwardTransition returns null in terminal states',
    forwardTransition('COMPLETED') === null &&
      forwardTransition('CANCELLED') === null,
  );
  check(
    'forwardTransition walks the whole lifecycle without a dead end',
    (() => {
      let state: LifecycleState = 'DRAFT';
      const seen: LifecycleState[] = [state];
      for (let i = 0; i < 32; i++) {
        const transition = forwardTransition(state, SHAPE_8);
        if (!transition) break;
        state = nextState(state, transition, SHAPE_8);
        seen.push(state);
      }
      return state === 'COMPLETED' && seen.length === 12;
    })(),
  );

  // ---- 11. knockoutStages agrees with the shape ----
  check(
    'knockoutStages(8, third place) has 4 stages',
    knockoutStages(SHAPE_8).length === 4,
  );

  // ---- 12. Bracket sizing (D6/D13) ----
  {
    check(
      '8 / 16 / 32 / 64 are the supported sizes',
      isBracketSize(8) &&
        isBracketSize(16) &&
        isBracketSize(32) &&
        isBracketSize(64),
    );
    check('12 is not a supported bracket size', !isBracketSize(12));
    // The rule INVERTED here: it used to pick the largest bracket the field
    // could fill, which cut everyone past the nearest power of two. It now
    // picks the smallest bracket that fits the whole field, so nobody who
    // qualified is dropped and the surplus slots become byes.
    check(
      'auto-size picks the smallest bracket that fits the field',
      autoBracketSize(20) === 32,
    );
    check('a field of 9 plays a 16, not an 8', autoBracketSize(9) === 16);
    check('auto-size is exact on a boundary', autoBracketSize(32) === 32);
    check('the minimum field plays the minimum draw', autoBracketSize(8) === 8);
    check(
      'auto-size caps at the largest supported bracket',
      autoBracketSize(500) === 64,
    );
    check(
      'auto-size refuses a field below the smallest bracket',
      autoBracketSize(7) === null,
    );

    // Sizing as data — the shape the guard and the admin preview both read.
    const short = decideBracketSizing(2, null);
    check(
      'a field of 2 is refused with a shortfall, not an exception',
      !short.ok && short.reason === 'BELOW_MINIMUM' && short.shortfall === 6,
    );
    const explicitTooSmall = decideBracketSizing(2, 8);
    check(
      'an explicit bracket size does NOT bypass the minimum',
      !explicitTooSmall.ok && explicitTooSmall.reason === 'BELOW_MINIMUM',
    );
    const nine = decideBracketSizing(9, null);
    check(
      'a field of 9 yields a 16-draw with 7 byes and nobody cut',
      nine.ok &&
        nine.bracketSize === 16 &&
        nine.qualifiedCount === 9 &&
        nine.byeCount === 7 &&
        nine.cutCount === 0,
    );
    const huge = decideBracketSizing(100, null);
    check(
      'a field above the maximum is cut to 64 with no byes',
      huge.ok &&
        huge.bracketSize === 64 &&
        huge.byeCount === 0 &&
        huge.cutCount === 36,
    );

    // Byes must land on the TOP seeds, deterministically. The reflection order
    // guarantees it without anything allocating them: the seeds left unfilled
    // are always the worst, so their absent opponents are always the best.
    const plan = buildBracketPlan({
      bracketSize: 16,
      thirdPlaceEnabled: false,
      qualifiedCount: 9,
    });
    const firstRound = plan.matches.filter((m) => m.stage === 'R16');
    const byeSeeds = firstRound
      .filter((m) => (m.seedA === null) !== (m.seedB === null))
      .map((m) => m.seedA ?? m.seedB)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    check('9-in-16 produces exactly 7 byes', plan.byeCount === 7);
    check(
      'byes go to seeds 1..7 — the highest seeds, in order',
      JSON.stringify(byeSeeds) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
    );
    check(
      'no first-round match is void under automatic sizing',
      firstRound.every((m) => m.seedA !== null || m.seedB !== null),
    );

    // Every legal automatic field size, end to end.
    for (let field = 8; field <= 64; field++) {
      const sizing = decideBracketSizing(field, null);
      if (!sizing.ok) {
        check(`field of ${field} sizes cleanly`, false);
        continue;
      }
      const p = buildBracketPlan({
        bracketSize: sizing.bracketSize,
        thirdPlaceEnabled: false,
        qualifiedCount: sizing.qualifiedCount,
      });
      const opening = p.matches.filter((m) => m.stage === p.stages[0]);
      const voids = opening.filter(
        (m) => m.seedA === null && m.seedB === null,
      ).length;
      if (voids > 0 || p.byeCount !== sizing.byeCount) {
        check(
          `field of ${field}: ${voids} void(s), ${p.byeCount} byes vs ${sizing.byeCount} predicted`,
          false,
        );
      }
    }
    check('every field from 8 to 64 builds a void-free bracket', true);
  }

  // ---- 13. Configuration layering ----
  {
    const base = resolveTournamentConfig(null);
    check(
      'defaults: three simulation rounds at 30/20/10 (D7/D13)',
      base.simulationRounds === 3 &&
        base.simulationDurationsSeconds[0] === 1800 &&
        base.simulationDurationsSeconds[1] === 1200 &&
        base.simulationDurationsSeconds[2] === 600,
      JSON.stringify(base.simulationDurationsSeconds),
    );
    check(
      'defaults: knockout durations follow D7',
      base.stageDurationsSeconds.R32 === 1200 &&
        base.stageDurationsSeconds.R16 === 1800 &&
        base.stageDurationsSeconds.QF === 2400 &&
        base.stageDurationsSeconds.SF === 3000 &&
        base.stageDurationsSeconds.FINAL === 3600,
    );

    const overridden = resolveTournamentConfig({
      bracketSize: 16,
      thirdPlaceEnabled: false,
      minRegistrations: 4,
      maxRegistrations: 40,
      roundDurations: { simulation: [60, 30, 15], stages: { FINAL: 120 } },
    });
    check('per-tournament bracket size wins', overridden.bracketSize === 16);
    check(
      'per-tournament third-place flag wins',
      overridden.thirdPlaceEnabled === false,
    );
    check(
      'per-tournament limits win',
      overridden.minRegistrations === 4 && overridden.maxRegistrations === 40,
    );
    check(
      'per-tournament simulation durations win',
      JSON.stringify(overridden.simulationDurationsSeconds) === '[60,30,15]',
    );
    check(
      'a single stage can be retimed on its own',
      overridden.stageDurationsSeconds.FINAL === 120,
    );
    check(
      'unlisted stages keep their default when one is overridden',
      overridden.stageDurationsSeconds.SF === base.stageDurationsSeconds.SF,
    );

    // Bad configuration must degrade, never throw — same rule as D20.
    const malformed = resolveTournamentConfig({
      bracketSize: 13,
      roundDurations: { simulation: 'not-an-array' },
    });
    check(
      'an unsupported bracket size falls back instead of throwing',
      malformed.bracketSize === base.bracketSize,
    );
    check(
      'malformed roundDurations falls back to defaults',
      JSON.stringify(malformed.simulationDurationsSeconds) ===
        JSON.stringify(base.simulationDurationsSeconds),
    );
    const unknownStage = resolveTournamentConfig({
      roundDurations: { stages: { NOT_A_STAGE: 99 } },
    });
    check(
      'an unknown stage name in the config is ignored, not fatal',
      unknownStage.stageDurationsSeconds.FINAL ===
        base.stageDurationsSeconds.FINAL,
    );
  }

  console.log(
    failures === 0
      ? '\nTournament lifecycle verified.'
      : `\n${failures} check(s) FAILED.`,
  );
}

try {
  main();
} catch (error) {
  console.error('\nFAIL —', error);
  failures++;
}
process.exit(failures > 0 ? 1 : 0);
