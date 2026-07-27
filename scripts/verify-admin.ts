import './load-env';
import { db } from '../src/server/db';
import {
  createTournament,
  updateTournament,
  updateTournamentSchedule,
  deleteTournament,
  applyTransition,
  listTournamentSummaries,
  getTournamentSummary,
  listRegistrations,
  removeRegistration,
  setTournamentArchived,
  listBracketRounds,
  registerCompetitor,
  configureTournament,
  resolveTournamentConfig,
  resolveEvaluationProfile,
} from '../src/server/modules/tournament';
import {
  addHiddenTest,
  archiveProblem,
  assignProblemToRound,
  createProblem,
  getProblemDetail,
  listAssignableProblems,
  listProblems,
  publishProblem,
  removeHiddenTest,
  updateProblem,
} from '../src/server/modules/problem';
import {
  disqualifySubmission,
  getAdminSubmission,
  getSubmission,
  listAllSubmissions,
  retryEvaluation,
  submitSolution,
  toPersistedStatus,
} from '../src/server/modules/submission';
import { listAuditLog, listUsers } from '../src/server/modules/admin/directory';
import {
  cancelRegistrationForAdmin,
  listPaymentsForAdmin,
  markManualPaymentPaidForAdmin,
  refundPaymentForAdmin,
} from '../src/server/modules/payment';
import {
  archiveTournamentSchema,
  configureTournamentFormSchema,
  createProblemFormSchema,
  createTournamentFormSchema,
  removeRegistrationSchema,
  scheduleFormSchema,
  updateProblemFormSchema,
  updateTournamentFormSchema,
} from '../src/lib/validation/admin.schema';
import { AppError } from '../src/lib/errors';
import { readFileSync } from 'node:fs';
import { attachProblemsToRounds } from './internal/harness-problems';

/**
 * Epic E5 acceptance: Admin Platform & Tournament Management.
 *
 * Covers the module operations the UI orchestrates, plus route/navigation
 * existence. It deliberately does not click through the browser; the UI is
 * server-rendered over these same modules and actions, so the regression value
 * is in the domain calls and guards.
 *
 * Run: npm run verify:admin
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function checkRejects(
  label: string,
  fn: () => Promise<unknown>,
  code?: AppError['code'],
) {
  try {
    await fn();
    check(label, false, 'resolved unexpectedly');
  } catch (error) {
    const ok =
      error instanceof AppError && (code === undefined || error.code === code);
    check(
      label,
      ok,
      error instanceof Error
        ? `${error.name}${error instanceof AppError ? `:${error.code}` : ''}`
        : String(error),
    );
  }
}

const TAG = `e5-admin-${Date.now()}`;

async function cleanup() {
  await db.webhookEvent.deleteMany({
    where: { payment: { tournament: { slug: { contains: TAG } } } },
  });
  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { contains: TAG } },
  });
  await db.evaluation.deleteMany({
    where: { submission: { tournament: { slug: { contains: TAG } } } },
  });
  await db.submissionRevision.deleteMany({
    where: { submission: { tournament: { slug: { contains: TAG } } } },
  });
  await db.submission.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.match.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.ranking.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.registration.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.payment.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.round.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.hiddenTest.deleteMany({
    where: { problem: { slug: { contains: TAG } } },
  });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
  await db.auditLog.deleteMany({ where: { entityId: { contains: TAG } } });
  await db.user.deleteMany({
    where: { email: { contains: '@e5-admin.test' } },
  });
}

async function makeUser(username: string, role: 'USER' | 'ADMIN' = 'USER') {
  return db.user.create({
    data: {
      authUserId: `auth-${TAG}-${username}`,
      email: `${username}@e5-admin.test`,
      username: `${username}-${TAG}`,
      displayName: username,
      role,
      profile: { create: {} },
    },
  });
}

async function main() {
  await cleanup();

  const admin = await makeUser('admin', 'ADMIN');
  const competitor = await makeUser('competitor');
  const rival = await makeUser('rival');

  // ---- Tournament CRUD + dashboard summaries ----
  const tournament = await createTournament(
    {
      name: 'E5 Admin Tournament',
      slug: TAG,
      passPriceMinor: 0,
      bracketSize: 8,
      minRegistrations: 1,
      maxRegistrations: 8,
    },
    { actorId: admin.id },
  );
  check('tournament created in DRAFT', tournament.status === 'DRAFT');

  await db.tournament.update({
    where: { id: tournament.id },
    data: { description: 'Admin-managed event', visibility: 'UNLISTED' },
  });
  const updated = await updateTournament(
    tournament.id,
    { name: 'E5 Admin Tournament Edited', bracketSize: 8 },
    { actorId: admin.id },
  );
  check(
    'tournament can be edited while draft',
    updated.name.endsWith('Edited'),
  );

  const now = new Date();
  await updateTournamentSchedule(
    tournament.id,
    {
      registrationOpensAt: new Date(now.getTime() - 3_600_000),
      registrationClosesAt: new Date(now.getTime() + 3_600_000),
      simulationOpensAt: new Date(now.getTime() + 7_200_000),
      simulationClosesAt: new Date(now.getTime() + 10_800_000),
      liveStartsAt: new Date(now.getTime() + 14_400_000),
    },
    { actorId: admin.id },
  );
  check(
    'invalid schedule is refused by Zod',
    !scheduleFormSchema.safeParse({
      registrationOpensAt: '2026-07-25T10:00',
      registrationClosesAt: '2026-07-25T09:00',
    }).success,
  );

  const summaries = await listTournamentSummaries({ includeArchived: true });
  check(
    'admin dashboard summaries include the tournament',
    summaries.some((summary) => summary.id === tournament.id),
  );
  const summary = await getTournamentSummary(tournament.id);
  check('summary includes visibility', summary.visibility === 'UNLISTED');
  check(
    'summary exposes lifecycle quick actions',
    summary.availableTransitions.includes('PUBLISH'),
  );

  await checkRejects(
    'duplicate tournament slug is typed CONFLICT',
    () =>
      createTournament({ name: 'Duplicate', slug: TAG }, { actorId: admin.id }),
    'CONFLICT',
  );
  check(
    'create tournament form validates slug',
    !createTournamentFormSchema.safeParse({ name: 'Bad', slug: 'Bad Slug' })
      .success,
  );
  check(
    'REGRESSION: update tournament form can clear description',
    updateTournamentFormSchema.safeParse({ description: '' }).data
      ?.description === null,
  );
  check(
    'REGRESSION: update tournament form can clear nullable numeric settings',
    updateTournamentFormSchema.safeParse({
      bracketSize: '',
      minRegistrations: '',
      maxRegistrations: '',
    }).data?.bracketSize === null,
  );
  check(
    'REGRESSION: third-place form false string persists as false',
    createTournamentFormSchema.safeParse({
      name: 'Third Place Disabled',
      slug: `${TAG}-third-place-disabled`,
      thirdPlaceEnabled: 'false',
    }).data?.thirdPlaceEnabled === false,
  );

  await applyTransition(tournament.id, 'PUBLISH', { actorId: admin.id });
  await applyTransition(tournament.id, 'OPEN_REGISTRATION', {
    actorId: admin.id,
  });
  check(
    'lifecycle controls call the E3 state machine',
    (await getTournamentSummary(tournament.id)).status === 'REGISTRATION_OPEN',
  );

  // ---- Registration management ----
  await registerCompetitor(tournament.id, competitor.id, {
    actorId: competitor.id,
  });
  await registerCompetitor(tournament.id, rival.id, { actorId: rival.id });
  const regs = await listRegistrations(tournament.id);
  check('registrations list includes competitors', regs.length === 2);
  await removeRegistration(
    tournament.id,
    rival.id,
    admin,
    'admin verification removal',
  );
  check(
    'admin can revoke a registration before seeding',
    (await listRegistrations(tournament.id, { status: 'ACTIVE' })).length ===
      1 &&
      (await listRegistrations(tournament.id, { status: 'REVOKED' })).some(
        (registration) => registration.userId === rival.id,
      ),
  );
  await checkRejects(
    'non-admin cannot remove a registration',
    () =>
      removeRegistration(
        tournament.id,
        competitor.id,
        competitor as { id: string; role: 'USER' | 'ADMIN' },
        'not allowed',
      ),
    'FORBIDDEN',
  );
  check(
    'remove registration schema requires a reason',
    !removeRegistrationSchema.safeParse({
      tournamentId: tournament.id,
      userId: competitor.id,
      reason: '',
    }).success,
  );

  // ---- Payment administration ----
  const manualUser = await makeUser('manual-payment');
  const manualPayment = await db.payment.create({
    data: {
      userId: manualUser.id,
      tournamentId: tournament.id,
      provider: 'MANUAL',
      providerOrderId: `${TAG}-manual-order`,
      amountMinor: 10000,
      currency: 'INR',
      status: 'PENDING',
    },
  });
  const manualPaid = await markManualPaymentPaidForAdmin(
    manualPayment.id,
    admin,
  );
  const manualRegistration = await db.registration.findUnique({
    where: {
      userId_tournamentId: {
        userId: manualUser.id,
        tournamentId: tournament.id,
      },
    },
  });
  check(
    'admin can mark manual payment paid through payment module',
    manualPaid.payment.status === 'PAID' &&
      manualRegistration?.status === 'ACTIVE' &&
      manualRegistration.paymentId === manualPayment.id,
  );

  const refunded = await refundPaymentForAdmin(
    manualPayment.id,
    admin,
    'verify admin refund',
    {
      gateway: {
        async createOrder() {
          throw new Error('not used');
        },
        async fetchPayment() {
          throw new Error('not used');
        },
        async refund(input) {
          return {
            id: `${TAG}-refund`,
            paymentId: input.paymentId,
            amount: input.amountMinor,
            currency: 'INR',
            status: 'processed',
          };
        },
      },
    },
  );
  const refundedRegistration = await db.registration.findUniqueOrThrow({
    where: {
      userId_tournamentId: {
        userId: manualUser.id,
        tournamentId: tournament.id,
      },
    },
  });
  check(
    'admin refund marks payment and registration refunded',
    refunded.status === 'REFUNDED' &&
      refundedRegistration.status === 'REFUNDED',
  );

  const cancelUser = await makeUser('cancel-payment');
  await registerCompetitor(tournament.id, cancelUser.id, {
    actorId: cancelUser.id,
  });
  await cancelRegistrationForAdmin(
    tournament.id,
    cancelUser.id,
    admin,
    'verify admin cancellation',
  );
  check(
    'payment admin cancellation releases registration slot',
    (await listRegistrations(tournament.id, { status: 'REVOKED' })).some(
      (registration) => registration.userId === cancelUser.id,
    ),
  );
  check(
    'admin payments list shows manual payment',
    (await listPaymentsForAdmin({ tournamentId: tournament.id })).some(
      (payment) => payment.id === manualPayment.id,
    ),
  );
  check(
    'payment admin actions are audited',
    (await db.auditLog.count({
      where: {
        entityType: { in: ['Payment', 'Registration'] },
        OR: [
          { action: 'payment.paid' },
          { action: 'payment.refunded' },
          { action: 'tournament.removeRegistration' },
        ],
      },
    })) >= 3,
  );

  // ---- Problem / challenge management ----
  const problem = await createProblem(
    {
      title: 'E5 REST API Challenge',
      slug: `${TAG}-problem`,
      category: 'REST_API',
      statementMarkdown: 'Build a REST API that responds to the hidden tests.',
      contractSpec: { healthPath: '/', performanceSamples: 1 },
    },
    admin,
  );
  check('challenge starts in DRAFT', problem.visibility === 'DRAFT');
  await checkRejects(
    'disabled challenge category is refused during authoring',
    () =>
      createProblem(
        {
          title: 'Unsupported',
          slug: `${TAG}-web`,
          category: 'WEB_APP',
          statementMarkdown: 'This category is not enabled for Week 1.',
        },
        admin,
      ),
    'VALIDATION',
  );
  check(
    'challenge form validates JSON',
    !createProblemFormSchema.safeParse({
      title: 'Bad JSON',
      slug: `${TAG}-bad-json`,
      category: 'REST_API',
      statementMarkdown: 'Enough statement text to pass validation.',
      contractSpec: '{not json',
    }).success,
  );
  check(
    'REGRESSION: update challenge form can clear optional fields',
    updateProblemFormSchema.safeParse({
      difficulty: '',
      starterRepoUrl: '',
    }).data?.difficulty === null,
  );
  const test = await addHiddenTest(
    problem.id,
    {
      name: 'root 200',
      kind: 'HTTP_ASSERTION',
      spec: { path: '/', expect: { status: 200 } },
      weight: 1,
      timeoutMs: 10_000,
    },
    admin,
  );
  await publishProblem(problem.id, admin);
  check(
    'published challenges appear in assignment picker',
    (await listAssignableProblems(admin)).some((p) => p.id === problem.id),
  );
  const problemDetail = await getProblemDetail(problem.id, admin);
  check(
    'admin detail includes hidden-test specs',
    problemDetail.tests[0]?.spec !== undefined,
  );
  await checkRejects(
    'REGRESSION: published challenge cannot lose its last hidden test',
    () => removeHiddenTest(test.id, admin),
    'CONFLICT',
  );
  await addHiddenTest(
    problem.id,
    {
      name: 'secondary 200',
      kind: 'HTTP_ASSERTION',
      spec: { path: '/', expect: { status: 200 } },
      weight: 1,
      timeoutMs: 10_000,
    },
    admin,
  );
  const pendingProblemRound = await db.round.create({
    data: {
      tournamentId: tournament.id,
      type: 'SIMULATION',
      stage: 'SIMULATION',
      sequence: 99,
      durationSeconds: 1800,
    },
  });
  await assignProblemToRound(pendingProblemRound.id, problem.id, admin);
  await checkRejects(
    'REGRESSION: assigned pending challenge cannot be archived',
    () => archiveProblem(problem.id, admin),
    'CONFLICT',
  );
  await db.round.update({
    where: { id: pendingProblemRound.id },
    data: { status: 'OPEN' },
  });
  await checkRejects(
    'REGRESSION: running challenge cannot receive new hidden tests',
    () =>
      addHiddenTest(
        problem.id,
        {
          name: 'late scoring change',
          kind: 'HTTP_ASSERTION',
          spec: { path: '/late', expect: { status: 200 } },
          weight: 1,
          timeoutMs: 10_000,
        },
        admin,
      ),
    'CONFLICT',
  );
  await checkRejects(
    'REGRESSION: running challenge cannot change contract spec',
    () =>
      updateProblem(
        problem.id,
        { contractSpec: { healthPath: '/changed' } },
        admin,
      ),
    'CONFLICT',
  );
  await db.round.update({
    where: { id: pendingProblemRound.id },
    data: { status: 'COMPLETED' },
  });
  await checkRejects(
    'non-admin cannot list challenges',
    () => listProblems(competitor as { id: string; role: 'USER' | 'ADMIN' }),
    'FORBIDDEN',
  );

  // ---- Submission management + evaluation queue ----
  await applyTransition(tournament.id, 'CLOSE_REGISTRATION', {
    actorId: admin.id,
    force: true,
  });
  await attachProblemsToRounds(tournament.id, TAG);
  await applyTransition(tournament.id, 'START_SIMULATION', {
    actorId: admin.id,
  });
  const simRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
  });
  await db.round.update({
    where: { id: simRound.id },
    data: {
      problemId: problem.id,
      opensAt: new Date(Date.now() - 60_000),
      deadlineAt: new Date(Date.now() + 3_600_000),
      status: 'OPEN',
    },
  });
  const submission = await submitSolution({
    userId: competitor.id,
    roundId: simRound.id,
    repoUrl: 'https://github.com/vercel/next.js',
    deploymentUrl: 'https://example.com/e5-admin',
  });
  check(
    'submission is accepted through E4 logic',
    submission.submission.version === 1,
  );
  check(
    'accepting a submission enqueues evaluation',
    Boolean(submission.jobId),
  );
  check(
    'admin submissions list can see the entry',
    (await listAllSubmissions(admin, { tournamentId: tournament.id }))
      .length === 1,
  );
  await checkRejects(
    'admin cannot retry an in-flight evaluation',
    () => retryEvaluation(submission.submission.id, admin),
    'CONFLICT',
  );
  await db.submission.update({
    where: { id: submission.submission.id },
    data: { status: toPersistedStatus('FAILED') },
  });
  const retried = await retryEvaluation(submission.submission.id, admin);
  check(
    'admin can retry a failed evaluation',
    Boolean(retried.jobId) && retried.state === 'QUEUED',
  );
  await disqualifySubmission(
    submission.submission.id,
    admin,
    'verify admin disqualification',
  );
  check(
    'admin can disqualify a submission',
    (await listAllSubmissions(admin, { tournamentId: tournament.id }))[0]
      ?.state === 'DISQUALIFIED',
  );
  await checkRejects(
    'non-admin cannot retry evaluation',
    () =>
      retryEvaluation(
        submission.submission.id,
        competitor as { id: string; role: 'USER' | 'ADMIN' },
      ),
    'FORBIDDEN',
  );

  // ---- Evaluation and bracket inspection ----
  await db.evaluation.create({
    data: {
      submissionId: submission.submission.id,
      tournamentId: tournament.id,
      attempt: 1,
      functionalScore: 90,
      performanceScore: 80,
      securityReliabilityScore: 70,
      aiScore: 0,
      overallScore: 83,
      testsPassed: 1,
      testsTotal: 1,
      testResults: [{ passed: true }],
      deploymentReachable: true,
      weights: { functional: 0.6 },
      profileName: 'deterministic',
      dimensions: { ai: false },
      probeEvidence: { latency: 100 },
      llmProvider: 'none',
      modelId: 'none',
      modelPromptHash: 'hash',
      submissionVersion: 1,
    },
  });
  check(
    'evaluation evidence is inspectable from admin read model',
    (await listAllSubmissions(admin, { tournamentId: tournament.id }))[0]
      ?.evaluation?.probeEvidence !== undefined,
  );
  const competitorSubmissionView = await getSubmission(
    submission.submission.id,
    competitor,
  );
  check(
    'REGRESSION: competitor submission view strips raw evidence',
    competitorSubmissionView.evaluation !== null &&
      !('testResults' in competitorSubmissionView.evaluation) &&
      !('probeEvidence' in competitorSubmissionView.evaluation) &&
      !('repoTextSnapshot' in competitorSubmissionView.evaluation) &&
      !('llmRaw' in competitorSubmissionView.evaluation),
  );
  check(
    'REGRESSION: admin submission view keeps raw evidence',
    (await getAdminSubmission(submission.submission.id, admin)).evaluation
      ?.probeEvidence !== undefined,
  );
  check(
    'bracket inspection returns an empty state before generation',
    (await listBracketRounds(tournament.id)).length === 0,
  );

  // ---- Archive, delete draft, audit, users, navigation ----
  await checkRejects(
    'running tournaments cannot be archived',
    () => setTournamentArchived(tournament.id, true, admin),
    'CONFLICT',
  );

  const draft = await createTournament(
    { name: 'Draft to delete', slug: `${TAG}-delete` },
    { actorId: admin.id },
  );
  await deleteTournament(draft.id, { actorId: admin.id });
  check(
    'delete draft tournament removes the row',
    (await db.tournament.findUnique({ where: { id: draft.id } })) === null,
  );

  check(
    'users directory is admin-only and includes registrations/submissions',
    (await listUsers(admin)).some((user) => user.id === competitor.id),
  );
  await checkRejects(
    'non-admin cannot read users directory',
    () => listUsers(competitor as { id: string; role: 'USER' | 'ADMIN' }),
    'FORBIDDEN',
  );
  check(
    'audit log records privileged actions',
    (await listAuditLog(admin, { take: 200 })).some((row) =>
      row.action.startsWith('tournament.'),
    ),
  );

  const nav = readFileSync('src/app/(admin)/admin/admin-nav.tsx', 'utf8');
  for (const label of [
    'Dashboard',
    'Tournaments',
    'Payments',
    'Challenges',
    'Submissions',
    'Evaluations',
    'Users',
    'Audit log',
    'Settings',
  ]) {
    check(`admin navigation includes ${label}`, nav.includes(label));
  }

  const guardedFiles = [
    'src/app/(admin)/admin/page.tsx',
    'src/app/(admin)/admin/tournaments/page.tsx',
    'src/app/(admin)/admin/payments/page.tsx',
    'src/app/(admin)/admin/payments/[paymentId]/page.tsx',
    'src/app/(admin)/admin/challenges/page.tsx',
    'src/app/(admin)/admin/submissions/page.tsx',
    'src/app/(admin)/admin/evaluations/page.tsx',
    'src/app/(admin)/admin/users/page.tsx',
    'src/app/(admin)/admin/audit/page.tsx',
  ];
  for (const file of guardedFiles) {
    check(
      `${file} has an admin guard`,
      readFileSync(file, 'utf8').includes('requireAdmin'),
    );
  }
  check(
    'REGRESSION: prize-pool settings action records an audit row',
    readFileSync('src/server/actions/admin.actions.ts', 'utf8').includes(
      'tournament.updatePrizePoolSettings',
    ),
  );
  check(
    'REGRESSION: E5 tournament admin fields are audited',
    readFileSync('src/server/actions/admin.actions.ts', 'utf8').includes(
      'tournament.updateAdminFields',
    ),
  );
  check(
    'REGRESSION: hidden-test sequence allocation is serialized',
    readFileSync('src/server/modules/problem/problems.ts', 'utf8').includes(
      'pg_advisory_xact_lock',
    ),
  );
  check(
    'REGRESSION: problem publish serializes hidden-test count',
    readFileSync('src/server/modules/problem/problems.ts', 'utf8').includes(
      'publishProblem',
    ) &&
      readFileSync('src/server/modules/problem/problems.ts', 'utf8').includes(
        'include: { _count: { select: { hiddenTests: true } } }',
      ),
  );
  check(
    'REGRESSION: archived challenges are hidden from the main list',
    readFileSync('src/server/modules/problem/problems.ts', 'utf8').includes(
      "visibility: { not: 'ARCHIVED' }",
    ),
  );
  check(
    'REGRESSION: archived tournament filter is applied before take',
    readFileSync('src/server/modules/tournament/admin-ops.ts', 'utf8').includes(
      'archivedOnly',
    ),
  );
  check(
    'REGRESSION: visibility-only tournament edits skip structural lifecycle guard',
    readFileSync('src/server/actions/admin.actions.ts', 'utf8').includes(
      'structuralChanged',
    ),
  );
  check(
    'REGRESSION: registration revocation is conditional on active status',
    readFileSync('src/server/modules/tournament/admin-ops.ts', 'utf8').includes(
      "status: 'ACTIVE'",
    ) &&
      readFileSync(
        'src/server/modules/tournament/admin-ops.ts',
        'utf8',
      ).includes('revoked.count !== 1'),
  );
  check(
    'REGRESSION: queue health is not capped to historical rows',
    !readFileSync(
      'src/server/modules/tournament/admin-ops.ts',
      'utf8',
    ).includes('take: 5000'),
  );
  const newTournamentForm = readFileSync(
    'src/app/(admin)/admin/tournaments/new/tournament-form.tsx',
    'utf8',
  );
  check(
    'REGRESSION: unchecked third-place checkbox submits false',
    newTournamentForm.includes('name="thirdPlaceEnabled"') &&
      newTournamentForm.includes('value="false"'),
  );
  check(
    'REGRESSION: timeline form preserves simulation close time',
    readFileSync(
      'src/app/(admin)/admin/tournaments/[tournamentId]/tabs/timeline.tsx',
      'utf8',
    ).includes('simulationClosesAt: summary.simulationClosesAt'),
  );
  check(
    'REGRESSION: tournament settings form preserves registration limits',
    readFileSync(
      'src/app/(admin)/admin/tournaments/[tournamentId]/tabs/settings.tsx',
      'utf8',
    ).includes('summary.minRegistrations') &&
      readFileSync(
        'src/app/(admin)/admin/tournaments/[tournamentId]/tabs/settings.tsx',
        'utf8',
      ).includes('summary.maxRegistrations'),
  );

  await db.round.update({
    where: { id: simRound.id },
    data: { status: 'COMPLETED' },
  });
  await removeHiddenTest(test.id, admin);
  await updateProblem(
    problem.id,
    { title: 'E5 REST API Challenge Edited' },
    admin,
  );
  await archiveProblem(problem.id, admin);
  check(
    'challenge can be archived after use',
    (await getProblemDetail(problem.id, admin)).visibility === 'ARCHIVED',
  );

  // ── E5 follow-up: configuration surface + boolean parsing ──────────────────

  // 1. `archived` must not use JS truthiness: Boolean("false") === true, so a
  //    string-valued argument used to archive when it meant "unarchive".
  check(
    'REGRESSION: archive flag parses the string "false" as false',
    archiveTournamentSchema.safeParse({
      tournamentId: tournament.id,
      archived: 'false',
    }).data?.archived === false,
  );
  check(
    'REGRESSION: archive flag parses "0" as false',
    archiveTournamentSchema.safeParse({
      tournamentId: tournament.id,
      archived: '0',
    }).data?.archived === false,
  );
  check(
    'archive flag still accepts real booleans and "true"',
    archiveTournamentSchema.safeParse({
      tournamentId: tournament.id,
      archived: true,
    }).data?.archived === true &&
      archiveTournamentSchema.safeParse({
        tournamentId: tournament.id,
        archived: 'true',
      }).data?.archived === true,
  );

  // 2. The configure action used to take `unknown` and cast it with `as never`,
  //    so nothing validated the payload. Invalid values must now be refused.
  check(
    'REGRESSION: configuration schema refuses a negative round duration',
    configureTournamentFormSchema.safeParse({
      stageDurationQF: '-60',
    }).success === false,
  );
  check(
    'REGRESSION: configuration schema refuses malformed evaluation-profile JSON',
    configureTournamentFormSchema.safeParse({
      evaluationProfiles: '{not json',
    }).success === false,
  );
  check(
    'configuration schema refuses a non-object evaluation-profile payload',
    configureTournamentFormSchema.safeParse({
      evaluationProfiles: '[1,2,3]',
    }).success === false,
  );

  // 3. Flat duration fields fold into the nested shape the module stores.
  {
    const parsed = configureTournamentFormSchema.safeParse({
      thirdPlaceEnabled: 'false',
      simulationDuration1: '1800',
      simulationDuration2: '1200',
      simulationDuration3: '600',
      stageDurationQF: '2400',
      evaluationProfiles: '',
    });
    check(
      'configuration form folds durations into { simulation, stages }',
      JSON.stringify(parsed.data?.roundDurations) ===
        JSON.stringify({ simulation: [1800, 1200, 600], stages: { QF: 2400 } }),
      JSON.stringify(parsed.data?.roundDurations),
    );
    check(
      'REGRESSION: third-place toggle survives the configuration form as false',
      parsed.data?.thirdPlaceEnabled === false,
    );
    check(
      'an empty evaluation-profile box means "no overrides", not invalid',
      JSON.stringify(parsed.data?.evaluationProfiles) === '{}',
    );
  }

  // A partially-filled simulation list must not produce a sparse array — holes
  // serialise as null and would fail the module's positive-integer check.
  check(
    'a partial simulation duration list is omitted rather than sent sparse',
    configureTournamentFormSchema.safeParse({
      simulationDuration1: '1800',
    }).data?.roundDurations.simulation === undefined,
  );

  // 4. End to end through the real action: the settings UI can now persist all
  //    three settings the backend supported but no form reached.
  {
    const configurable = await createTournament(
      {
        name: 'E5 Configuration Target',
        slug: `${TAG}-configurable`,
        minRegistrations: 2,
      },
      { actorId: admin.id },
    );

    await configureTournament(
      configurable.id,
      {
        thirdPlaceEnabled: false,
        roundDurations: {
          simulation: [900, 600, 300],
          stages: { FINAL: 3000 },
        },
        evaluationProfiles: { stages: { QF: 'full' } },
      },
      { actorId: admin.id },
    );

    const summary = await getTournamentSummary(configurable.id);
    check(
      'third-place toggle persists through configuration',
      summary.thirdPlaceEnabled === false,
    );
    // Compared field by field, not as a JSON string: Postgres `jsonb` does not
    // preserve key insertion order, so a string comparison would be flaky.
    const storedDurations = summary.roundDurations as {
      simulation?: number[];
      stages?: Record<string, number>;
    } | null;
    check(
      'round durations persist and are exposed to the settings UI',
      JSON.stringify(storedDurations?.simulation) ===
        JSON.stringify([900, 600, 300]) &&
        storedDurations?.stages?.FINAL === 3000,
      JSON.stringify(summary.roundDurations),
    );
    check(
      'evaluation profiles persist and are exposed to the settings UI',
      JSON.stringify(summary.evaluationProfiles) ===
        JSON.stringify({ stages: { QF: 'full' } }),
      JSON.stringify(summary.evaluationProfiles),
    );

    // The stored overrides must actually reach the resolver, or the UI would be
    // editing a value nothing reads.
    const resolved = resolveTournamentConfig({
      bracketSize: summary.bracketSize,
      thirdPlaceEnabled: summary.thirdPlaceEnabled,
      minRegistrations: summary.minRegistrations,
      maxRegistrations: summary.maxRegistrations,
      roundDurations: summary.roundDurations,
    });
    check(
      'stored round durations reach resolveTournamentConfig (D7)',
      resolved.simulationDurationsSeconds[0] === 900 &&
        resolved.stageDurationsSeconds.FINAL === 3000,
      `${resolved.simulationDurationsSeconds[0]} / ${resolved.stageDurationsSeconds.FINAL}`,
    );
    check(
      'stored evaluation profiles reach resolveEvaluationProfile (D20)',
      resolveEvaluationProfile('QF', summary.evaluationProfiles).name ===
        'full',
    );

    // The module still refuses a malformed D20 payload.
    await checkRejects(
      'configuration refuses an invalid evaluation-profile object',
      () =>
        configureTournament(
          configurable.id,
          { evaluationProfiles: { stages: 42 } },
          { actorId: admin.id },
        ),
      'VALIDATION',
    );

    // And the shape freeze still holds once a bracket exists.
    await db.tournament.update({
      where: { id: configurable.id },
      data: { bracketGeneratedAt: new Date() },
    });
    await checkRejects(
      'third-place toggle is refused once the bracket is generated',
      () =>
        configureTournament(
          configurable.id,
          { thirdPlaceEnabled: true },
          { actorId: admin.id },
        ),
      'CONFLICT',
    );
    check(
      'the settings UI is told the bracket shape is frozen',
      (await getTournamentSummary(configurable.id)).bracketGeneratedAt !== null,
    );
  }

  if (failures > 0) {
    throw new Error(`${failures} check(s) FAILED.`);
  }
  console.log('\nAdmin platform verified.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await db.$disconnect();
  });
