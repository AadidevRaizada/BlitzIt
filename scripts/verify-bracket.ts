import './load-env';
import {
  assertBracketPlanValid,
  BracketError,
  buildBracketPlan,
  matchCountForBracket,
  seedOrder,
  type BracketPlan,
} from '../src/server/modules/tournament/bracket';
import { SUPPORTED_BRACKET_SIZES } from '../src/server/modules/tournament/config.public';
import {
  decideMatch,
  rankByWinRule,
  TIE_BREAK_CHAIN,
  type CompetitorResult,
} from '../src/server/modules/tournament/win-rule';
import { rankSeedingEntries } from '../src/server/modules/tournament/seeding';

/**
 * Epic E3 — bracket, seeding and win-rule acceptance.
 *
 * PURE checks only: no database. Everything the bracket engine promises —
 * determinism, no duplicate participants, no duplicate matches, no orphan
 * rounds, correct byes, the full D5 tie-break chain — is proved here at every
 * supported size.
 *
 * Run: npm run verify:bracket
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

function expectThrows(
  label: string,
  fn: () => unknown,
  expected = BracketError,
) {
  let threw = false;
  let detail = '';
  try {
    fn();
  } catch (error) {
    threw = error instanceof expected;
    if (!threw) detail = `threw ${(error as Error).name}`;
  }
  check(label, threw, detail || 'did not throw');
}

/**
 * Play a whole bracket in memory, letting the better seed always win. In a
 * correct single-elimination draw this must produce seed 1 as champion and
 * seed 2 as runner-up — the classic property that catches a mis-ordered
 * pairing which unit-level position checks would miss.
 */
function playBySeed(plan: BracketPlan) {
  const slots = new Map<string, { A: number | null; B: number | null }>();
  const key = (stage: string, position: number | null) =>
    `${stage}#${position}`;

  for (const match of plan.matches) {
    slots.set(key(match.stage, match.bracketPosition), {
      A: match.seedA,
      B: match.seedB,
    });
  }

  const results = new Map<
    string,
    { winner: number | null; loser: number | null }
  >();

  for (const stage of plan.stages) {
    const stageMatches = plan.matches
      .filter((m) => m.stage === stage)
      .sort((a, b) => a.bracketPosition - b.bracketPosition);

    for (const match of stageMatches) {
      const slot = slots.get(key(match.stage, match.bracketPosition))!;
      const present = [slot.A, slot.B].filter(
        (seed): seed is number => seed !== null,
      );
      const winner = present.length > 0 ? Math.min(...present) : null;
      const loser = present.length === 2 ? Math.max(...present) : null;

      results.set(key(match.stage, match.bracketPosition), { winner, loser });

      if (match.nextStage !== null) {
        const target = slots.get(key(match.nextStage, match.nextPosition))!;
        target[match.nextSlot as 'A' | 'B'] = winner;
      }
      if (match.loserNextStage !== null) {
        const target = slots.get(
          key(match.loserNextStage, match.loserNextPosition),
        )!;
        target[match.loserNextSlot as 'A' | 'B'] = loser;
      }
    }
  }

  const final = results.get(key('FINAL', 0))!;
  const third = plan.thirdPlaceEnabled
    ? results.get(key('THIRD_PLACE', 0))!
    : null;

  return {
    champion: final.winner,
    runnerUp: final.loser,
    third: third?.winner ?? null,
    fourth: third?.loser ?? null,
  };
}

function competitor(
  userId: string,
  overrides: Partial<CompetitorResult> = {},
): CompetitorResult {
  return {
    userId,
    seed: null,
    submissionId: `sub-${userId}`,
    submittedAt: new Date('2026-07-25T10:00:00Z'),
    evaluationPending: false,
    overallScore: 50,
    functionalScore: 50,
    testsPassed: 5,
    performanceScore: 50,
    aiScore: 50,
    ...overrides,
  };
}

function main() {
  // ---- 1. Seed order ----
  {
    check('seedOrder(2) = [1, 2]', JSON.stringify(seedOrder(2)) === '[1,2]');
    check(
      'seedOrder(4) = [1, 4, 2, 3]',
      JSON.stringify(seedOrder(4)) === '[1,4,2,3]',
      seedOrder(4).join(','),
    );
    check(
      'seedOrder(8) = [1, 8, 4, 5, 2, 7, 3, 6]',
      JSON.stringify(seedOrder(8)) === '[1,8,4,5,2,7,3,6]',
      seedOrder(8).join(','),
    );

    for (const size of SUPPORTED_BRACKET_SIZES) {
      const order = seedOrder(size);
      check(
        `seedOrder(${size}) contains every seed exactly once`,
        new Set(order).size === size && order.length === size,
      );
      const pairsSum = [];
      for (let i = 0; i < order.length; i += 2) {
        pairsSum.push(order[i]! + order[i + 1]!);
      }
      check(
        `seedOrder(${size}) pairs every seed s with ${size + 1}-s`,
        pairsSum.every((sum) => sum === size + 1),
      );
      check(
        `seedOrder(${size}) puts seed 1 against seed ${size}`,
        order[0] === 1 && order[1] === size,
      );
    }

    expectThrows(
      'seedOrder refuses a non-power-of-two',
      () => seedOrder(12),
      Error,
    );
  }

  // ---- 2. Bracket structure at every supported size ----
  for (const size of SUPPORTED_BRACKET_SIZES) {
    for (const thirdPlace of [true, false]) {
      const label = `${size}-team${thirdPlace ? ' + 3rd place' : ''}`;
      const plan = buildBracketPlan({
        bracketSize: size,
        thirdPlaceEnabled: thirdPlace,
        qualifiedCount: size,
      });

      check(
        `${label}: ${matchCountForBracket(size, thirdPlace)} matches`,
        plan.matches.length === matchCountForBracket(size, thirdPlace),
        `got ${plan.matches.length}`,
      );
      check(
        `${label}: no duplicate matches`,
        new Set(plan.matches.map((m) => `${m.stage}#${m.bracketPosition}`))
          .size === plan.matches.length,
      );
      check(
        `${label}: no duplicate participants`,
        (() => {
          const seeds = plan.matches
            .flatMap((m) => [m.seedA, m.seedB])
            .filter((s): s is number => s !== null);
          return new Set(seeds).size === seeds.length && seeds.length === size;
        })(),
      );
      check(
        `${label}: no orphan rounds`,
        plan.rounds.every(
          (round) =>
            plan.matches.filter((m) => m.stage === round.stage).length ===
            round.matchCount,
        ) && plan.rounds.every((r) => r.matchCount > 0),
      );
      check(
        `${label}: every round halves the field`,
        (() => {
          const main = plan.rounds.filter((r) => r.stage !== 'THIRD_PLACE');
          return main.every(
            (round, i) => round.matchCount === size / 2 ** (i + 1),
          );
        })(),
      );
      check(`${label}: no bye when the field is full`, plan.byeCount === 0);

      // The property test: better seed always wins.
      const outcome = playBySeed(plan);
      check(
        `${label}: seed 1 wins, seed 2 is runner-up`,
        outcome.champion === 1 && outcome.runnerUp === 2,
        JSON.stringify(outcome),
      );
      if (thirdPlace) {
        check(
          `${label}: the two losing semi-finalists (3, 4) play off`,
          outcome.third === 3 && outcome.fourth === 4,
          JSON.stringify(outcome),
        );
      } else {
        check(
          `${label}: no third-place match exists`,
          !plan.stages.includes('THIRD_PLACE') &&
            plan.matches.every((m) => m.loserNextStage === null),
        );
      }
    }
  }

  // ---- 3. Determinism ----
  {
    const a = buildBracketPlan({
      bracketSize: 32,
      thirdPlaceEnabled: true,
      qualifiedCount: 32,
    });
    const b = buildBracketPlan({
      bracketSize: 32,
      thirdPlaceEnabled: true,
      qualifiedCount: 32,
    });
    check(
      'the same inputs produce a byte-identical bracket',
      JSON.stringify(a) === JSON.stringify(b),
    );
  }

  // ---- 4. Byes ----
  {
    const plan = buildBracketPlan({
      bracketSize: 16,
      thirdPlaceEnabled: true,
      qualifiedCount: 11,
    });
    check(
      '16-slot bracket with 11 competitors has 5 byes',
      plan.byeCount === 5,
      `${plan.byeCount}`,
    );
    check(
      'byes fall to the top seeds (their opponents are the missing seeds)',
      (() => {
        const byeMatches = plan.matches.filter(
          (m) => m.stage === 'R16' && (m.seedA === null) !== (m.seedB === null),
        );
        return byeMatches.every((m) => (m.seedA ?? m.seedB)! <= 5);
      })(),
    );
    check(
      'no first-round match is entirely empty when the field exceeds half the bracket',
      plan.matches
        .filter((m) => m.stage === 'R16')
        .every((m) => m.seedA !== null || m.seedB !== null),
    );
    check(
      'byes still leave the structure valid',
      (() => {
        try {
          assertBracketPlanValid(plan);
          return true;
        } catch {
          return false;
        }
      })(),
    );
    check(
      'a bye bracket still crowns the top seed',
      playBySeed(plan).champion === 1,
    );

    // A deliberately over-sized bracket: 9 competitors in 64 slots produces
    // matches with NO competitors at all, which must cascade rather than break.
    const oversized = buildBracketPlan({
      bracketSize: 64,
      thirdPlaceEnabled: true,
      qualifiedCount: 9,
    });
    const emptyFirstRound = oversized.matches.filter(
      (m) => m.stage === 'R64' && m.seedA === null && m.seedB === null,
    ).length;
    check(
      'a heavily over-sized bracket produces genuinely empty matches',
      emptyFirstRound > 0,
      `${emptyFirstRound} empty R64 matches`,
    );
    check(
      'an over-sized bracket is still structurally valid and still crowns seed 1',
      playBySeed(oversized).champion === 1,
    );
  }

  // ---- 5. Rejected inputs ----
  expectThrows('an unsupported bracket size is refused', () =>
    buildBracketPlan({
      bracketSize: 12,
      thirdPlaceEnabled: true,
      qualifiedCount: 12,
    }),
  );
  expectThrows('a single competitor cannot form a bracket', () =>
    buildBracketPlan({
      bracketSize: 8,
      thirdPlaceEnabled: true,
      qualifiedCount: 1,
    }),
  );
  expectThrows('more competitors than slots is refused', () =>
    buildBracketPlan({
      bracketSize: 8,
      thirdPlaceEnabled: true,
      qualifiedCount: 9,
    }),
  );

  // ---- 6. The D5 win rule, step by step ----
  {
    const options = {
      advanceHigherSeedOnDoubleNoShow: true,
      windowClosed: true,
    };

    check(
      'higher overall score wins (D5 base rule)',
      (() => {
        const outcome = decideMatch(
          competitor('a', { overallScore: 80 }),
          competitor('b', { overallScore: 79.99 }),
          options,
        );
        return (
          outcome.kind === 'DECIDED' &&
          outcome.winnerId === 'a' &&
          outcome.reason === 'SCORE'
        );
      })(),
    );

    check(
      'tie-break 1: higher functional score',
      (() => {
        const outcome = decideMatch(
          competitor('a', { overallScore: 80, functionalScore: 90 }),
          competitor('b', { overallScore: 80, functionalScore: 89 }),
          options,
        );
        return (
          outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_FUNCTIONAL'
        );
      })(),
    );

    check(
      'tie-break 2: more hidden tests passed',
      (() => {
        const outcome = decideMatch(
          competitor('a', {
            overallScore: 80,
            functionalScore: 90,
            testsPassed: 9,
          }),
          competitor('b', {
            overallScore: 80,
            functionalScore: 90,
            testsPassed: 8,
          }),
          options,
        );
        return outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_TESTS';
      })(),
    );

    check(
      'tie-break 3: faster submission',
      (() => {
        const outcome = decideMatch(
          competitor('a', { submittedAt: new Date('2026-07-25T10:00:00Z') }),
          competitor('b', { submittedAt: new Date('2026-07-25T10:05:00Z') }),
          options,
        );
        return outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_TIME';
      })(),
    );

    check(
      'tie-break 4: better performance',
      (() => {
        const outcome = decideMatch(
          competitor('a', { performanceScore: 70 }),
          competitor('b', { performanceScore: 69 }),
          options,
        );
        return (
          outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_PERFORMANCE'
        );
      })(),
    );

    check(
      'tie-break 5: higher AI score',
      (() => {
        const outcome = decideMatch(
          competitor('a', { aiScore: 60 }),
          competitor('b', { aiScore: 59 }),
          options,
        );
        return outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_AI';
      })(),
    );

    check(
      'tie-break 6: identical on every dimension => sudden death (D5.6)',
      decideMatch(competitor('a'), competitor('b'), options).kind === 'TIE',
    );

    check(
      'the tie-break chain is exactly the six D5 steps, in order',
      JSON.stringify(TIE_BREAK_CHAIN.map((s) => s.reason)) ===
        JSON.stringify([
          'SCORE',
          'TIEBREAK_FUNCTIONAL',
          'TIEBREAK_TESTS',
          'TIEBREAK_TIME',
          'TIEBREAK_PERFORMANCE',
          'TIEBREAK_AI',
        ]),
      TIE_BREAK_CHAIN.map((s) => s.reason).join(','),
    );

    // Ordering matters: a competitor who loses the overall score must not be
    // rescued by a better functional score.
    check(
      'a better functional score cannot overturn a worse overall score',
      (() => {
        const outcome = decideMatch(
          competitor('a', { overallScore: 70, functionalScore: 100 }),
          competitor('b', { overallScore: 80, functionalScore: 10 }),
          options,
        );
        return outcome.winnerId === 'b' && outcome.reason === 'SCORE';
      })(),
    );
  }

  // ---- 7. Byes, walkovers, no-shows, pending ----
  {
    const options = {
      advanceHigherSeedOnDoubleNoShow: true,
      windowClosed: true,
    };

    check(
      'an empty opponent slot is a bye',
      (() => {
        const outcome = decideMatch(competitor('a'), null, options);
        return outcome.kind === 'BYE' && outcome.winnerId === 'a';
      })(),
    );
    check(
      'a bye works from either side',
      decideMatch(null, competitor('b'), options).winnerId === 'b',
    );
    check(
      'two empty slots is a void match, not a crash',
      decideMatch(null, null, options).kind === 'VOID',
    );

    check(
      'a competitor who never submitted loses by walkover',
      (() => {
        const outcome = decideMatch(
          competitor('a'),
          competitor('b', { submissionId: null, overallScore: null }),
          options,
        );
        return (
          outcome.kind === 'WALKOVER' &&
          outcome.winnerId === 'a' &&
          outcome.loserId === 'b'
        );
      })(),
    );

    check(
      'a disqualified/unscored submission also loses by walkover',
      decideMatch(
        competitor('a'),
        competitor('b', { overallScore: null }),
        options,
      ).winnerId === 'a',
    );

    check(
      'an outstanding evaluation blocks the decision (never decide early)',
      decideMatch(
        competitor('a'),
        competitor('b', { evaluationPending: true }),
        options,
      ).kind === 'PENDING',
    );

    check(
      'a double no-show advances the better seed rather than stalling',
      (() => {
        const outcome = decideMatch(
          competitor('a', { seed: 5, submissionId: null, overallScore: null }),
          competitor('b', { seed: 3, submissionId: null, overallScore: null }),
          options,
        );
        return outcome.kind === 'WALKOVER' && outcome.winnerId === 'b';
      })(),
    );

    check(
      'with the no-show rule disabled, a double no-show stalls deliberately',
      decideMatch(
        competitor('a', { seed: 5, submissionId: null, overallScore: null }),
        competitor('b', { seed: 3, submissionId: null, overallScore: null }),
        { advanceHigherSeedOnDoubleNoShow: false, windowClosed: true },
      ).kind === 'TIE',
    );
  }

  // ---- 7b. Regression: the submission window gates every absence-based rule ----
  // Bug found during E3 E2E: with the window still OPEN, "nobody submitted yet"
  // was read as a double no-show, so the entire bracket walked over on seed
  // order the instant the first round opened.
  {
    const open = { advanceHigherSeedOnDoubleNoShow: true, windowClosed: false };
    const closed = {
      advanceHigherSeedOnDoubleNoShow: true,
      windowClosed: true,
    };

    const bothAbsent = () =>
      [
        competitor('a', { seed: 1, submissionId: null, overallScore: null }),
        competitor('b', { seed: 8, submissionId: null, overallScore: null }),
      ] as const;

    check(
      'REGRESSION: an open window never decides a match nobody has submitted to',
      decideMatch(...bothAbsent(), open).kind === 'PENDING',
    );
    check(
      'the same match resolves once the window closes',
      decideMatch(...bothAbsent(), closed).kind === 'WALKOVER',
    );
    check(
      'REGRESSION: an open window never awards a walkover against a competitor who can still submit',
      decideMatch(
        competitor('a'),
        competitor('b', { submissionId: null, overallScore: null }),
        open,
      ).kind === 'PENDING',
    );
    // CHANGED in E6 (Codex review): a fully-scored match is NOT decided while
    // the window is open. E4 lets a competitor REPLACE their entry until the
    // deadline, and a decided match is never re-decided — so deciding early
    // silently voided the right to improve. Two competitors who submitted in
    // the first minute would have had the match settled before either could
    // iterate.
    check(
      'REGRESSION: a fully-scored match is NOT decided while the window is open',
      decideMatch(
        competitor('a', { overallScore: 90 }),
        competitor('b', { overallScore: 10 }),
        open,
      ).kind === 'PENDING',
    );
    check(
      'the same fully-scored match decides once the window closes',
      decideMatch(
        competitor('a', { overallScore: 90 }),
        competitor('b', { overallScore: 10 }),
        closed,
      ).kind === 'DECIDED',
    );
    check(
      'a bye is structural and resolves even before the window opens',
      decideMatch(competitor('a'), null, open).kind === 'BYE',
    );
    check(
      'a void match is structural too',
      decideMatch(null, null, open).kind === 'VOID',
    );
  }

  // ---- 8. Ranking uses the same chain ----
  {
    const ranked = rankByWinRule([
      competitor('c', { overallScore: 70 }),
      competitor('a', { overallScore: 90 }),
      competitor('b', { overallScore: 80 }),
    ]);
    check(
      'rankByWinRule sorts best-first',
      ranked.map((r) => r.userId).join(',') === 'a,b,c',
      ranked.map((r) => r.userId).join(','),
    );
    check(
      'rankByWinRule is stable for genuinely equal competitors',
      rankByWinRule([competitor('x'), competitor('y'), competitor('z')])
        .map((r) => r.userId)
        .join(',') === 'x,y,z',
    );
  }

  // ---- 9. Seeding aggregation (D13) ----
  {
    const entry = (
      userId: string,
      scores: number[],
      overrides: Record<string, unknown> = {},
    ) => ({
      userId,
      simulationScore: scores.reduce((sum, s) => sum + s, 0),
      roundsScored: scores.length,
      functionalTotal: 0,
      testsPassedTotal: 0,
      performanceTotal: 0,
      aiTotal: 0,
      lastSubmittedAt: new Date('2026-07-25T10:00:00Z'),
      city: null,
      ...overrides,
    });

    const ranked = rankSeedingEntries([
      entry('slow-but-good', [90, 90, 90]),
      entry('one-great-round', [100, 0, 0]),
      entry('consistent', [80, 80, 80]),
      entry('never-showed', []),
    ]);

    check(
      'D13: seeding sums all three simulation rounds, it does not take the best',
      ranked.map((e) => e.userId).join(',') ===
        'slow-but-good,consistent,one-great-round,never-showed',
      ranked.map((e) => `${e.userId}=${e.simulationScore}`).join(' '),
    );

    const tied = rankSeedingEntries([
      entry('later', [50, 50], {
        lastSubmittedAt: new Date('2026-07-25T11:00:00Z'),
      }),
      entry('earlier', [50, 50], {
        lastSubmittedAt: new Date('2026-07-25T10:00:00Z'),
      }),
    ]);
    check(
      'ties at the cutline fall through to the D5 chain (faster submission wins)',
      tied[0]?.userId === 'earlier',
      tied.map((e) => e.userId).join(','),
    );
  }

  console.log(
    failures === 0
      ? '\nBracket, seeding and win rule verified.'
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
