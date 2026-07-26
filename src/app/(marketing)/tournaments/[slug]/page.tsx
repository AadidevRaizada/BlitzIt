import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { getCurrentUser } from '@/server/modules/auth';
import {
  DEFAULT_STAGE_PROFILES,
  getMyTournamentState,
  listPublicTournaments,
} from '@/server/modules/tournament';
import { DEFAULT_WEIGHTS } from '@/server/modules/evaluation/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Countdown } from '@/components/features/countdown';
import { RegisterControl } from '../register-control';
import { formatMinor } from '@/server/modules/notification';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  const [{ slug }, { intent }, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser(),
  ]);
  const grouped = await listPublicTournaments({ slug, take: 1 });
  const tournament =
    grouped.LIVE_NOW[0] ??
    grouped.REGISTERING[0] ??
    grouped.COMING_SOON[0] ??
    grouped.PAST[0] ??
    null;
  if (!tournament) notFound();

  const myState = user
    ? await getMyTournamentState(user.id, tournament.id)
    : null;
  const category =
    tournament.categories.length > 0
      ? tournament.categories.map(formatStage).join(', ')
      : 'REST API';
  const serverTime = new Date().toISOString();
  const expectedDuration = estimatedDuration(tournament);

  return (
    <main className="bg-background text-foreground min-h-screen">
      <section className="border-hairline border-b px-5 py-10 sm:px-7">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_340px]">
          <div>
            <Badge tone={tournament.status === 'LIVE' ? 'live' : 'info'}>
              {formatStage(tournament.status)}
            </Badge>
            <h1 className="font-pixel mt-4 text-4xl font-bold tracking-normal uppercase sm:text-6xl">
              {tournament.name}
            </h1>
            <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-6">
              Public tournament page for registration, schedule, rules,
              evaluation policy, and the current competitor action.
            </p>
          </div>
          <Card surface="broadcast" className="p-5">
            <dl className="grid gap-3 text-sm">
              <Meta
                label="Prize pool"
                value={formatMinor(tournament.prizePool.prizePoolMinor)}
              />
              <Meta
                label="Eligible entries"
                value={String(tournament.prizePool.paidEntries)}
              />
              <Meta
                label="Starts"
                value={
                  tournament.liveStartsAt
                    ? formatDate(tournament.liveStartsAt)
                    : 'Date TBA'
                }
              />
              <Meta
                label="Entry"
                value={
                  tournament.passPriceMinor > 0
                    ? formatMinor(tournament.passPriceMinor)
                    : 'Free'
                }
              />
              <Meta
                label="Competitors"
                value={`${tournament.participantCount}${
                  tournament.maxRegistrations
                    ? ` / ${tournament.maxRegistrations}`
                    : ''
                }`}
              />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  Registration closes in
                </dt>
                <dd className="text-right font-medium">
                  <Countdown
                    targetAt={
                      tournament.registrationClosesAt?.toISOString() ?? null
                    }
                    serverTime={serverTime}
                    phase={
                      tournament.status === 'REGISTRATION_OPEN'
                        ? 'OPEN'
                        : 'BEFORE_OPEN'
                    }
                  />
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-8">
          <Section title="Format">
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="Category" value={category} />
              <Info
                label="Bracket size"
                value={
                  tournament.bracketSize
                    ? String(tournament.bracketSize)
                    : 'Derived when seeded'
                }
              />
              <Info
                label="Third place"
                value={tournament.thirdPlaceEnabled ? 'Enabled' : 'Disabled'}
              />
              <Info label="Estimated duration" value={expectedDuration} />
            </div>
          </Section>

          <Section title="Timeline">
            <div className="grid gap-3">
              <TimelineRow
                label="Registration opens"
                date={tournament.registrationOpensAt}
              />
              <TimelineRow
                label="Registration closes"
                date={tournament.registrationClosesAt}
              />
              <TimelineRow
                label="Qualifiers open"
                date={tournament.simulationOpensAt}
              />
              <TimelineRow
                label="Qualifiers close"
                date={tournament.simulationClosesAt}
              />
              <TimelineRow
                label="Live bracket starts"
                date={tournament.liveStartsAt}
              />
            </div>
          </Section>

          <Section title="Rules">
            <ul className="grid gap-3 text-sm leading-6">
              <Rule>Problems reveal simultaneously when a round opens.</Rule>
              <Rule>One accepted submission per competitor per round.</Rule>
              <Rule>
                Shared deployments, late entries, or tampering with evaluation
                evidence can disqualify a submission.
              </Rule>
              <Rule>
                Tournament state, rankings, bracket advancement, and placements
                are derived from persisted results.
              </Rule>
            </ul>
          </Section>

          <Section title="Evaluation">
            <div className="grid gap-4 md:grid-cols-2">
              <Card surface="broadcast" className="p-4">
                <h3 className="font-semibold">D2 weights</h3>
                <dl className="mt-3 grid gap-2 text-sm">
                  <Meta
                    label="Functional"
                    value={`${Math.round(DEFAULT_WEIGHTS.functional * 100)}%`}
                  />
                  <Meta
                    label="Performance"
                    value={`${Math.round(DEFAULT_WEIGHTS.performance * 100)}%`}
                  />
                  <Meta
                    label="Security / reliability"
                    value={`${Math.round(
                      DEFAULT_WEIGHTS.securityReliability * 100,
                    )}%`}
                  />
                  <Meta
                    label="AI quality"
                    value={`${Math.round(DEFAULT_WEIGHTS.ai * 100)}%`}
                  />
                </dl>
              </Card>
              <Card surface="broadcast" className="p-4">
                <h3 className="font-semibold">AI scoring rule</h3>
                <p className="text-muted-foreground mt-3 text-sm leading-6">
                  Qualifiers through quarter-finals use deterministic scoring.
                  AI scoring applies only from semi-finals onward: SF,
                  third-place, and final.
                </p>
                <p className="text-muted-foreground mt-3 text-xs">
                  Default profile map: {aiStages()}.
                </p>
              </Card>
            </div>
          </Section>

          <Section title="FAQ">
            <div className="grid gap-3">
              <Faq
                q="Is entry paid today?"
                a={
                  tournament.passPriceMinor > 0
                    ? `Yes. Entry is ${formatMinor(tournament.passPriceMinor)}.`
                    : 'No. This tournament uses the free registration path.'
                }
              />
              <Faq
                q="How is the prize pool calculated?"
                a={`The stored pool is ${formatMinor(tournament.prizePool.prizePoolMinor)} from ${tournament.prizePool.paidEntries} eligible entries plus any configured floor, sponsor, or bonus contribution.`}
              />
              <Faq
                q="Can I browse before signing in?"
                a="Yes. Public tournament pages are visible to signed-out visitors; auth happens at registration."
              />
            </div>
          </Section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <Card surface="broadcast" className="p-5">
            <h2 className="font-pixel text-2xl font-bold uppercase">
              Register
            </h2>
            <div className="mt-4">
              <RegisterControl
                tournamentId={tournament.id}
                slug={tournament.slug}
                status={tournament.status}
                participantCount={tournament.participantCount}
                maxRegistrations={tournament.maxRegistrations}
                entryFeeMinor={tournament.passPriceMinor}
                currency={tournament.currency}
                userSignedIn={user !== null}
                state={myState}
                intent={intent}
              />
            </div>
          </Card>

          {myState ? (
            <Card surface="broadcast" className="p-5">
              <h2 className="font-semibold">Readiness</h2>
              <ul className="mt-4 grid gap-2 text-sm">
                <Ready ok={myState.readiness.githubConnected}>
                  GitHub connected
                </Ready>
                <Ready ok={myState.readiness.avatarSet}>Avatar set</Ready>
                <Ready ok={myState.readiness.profileLocationSet}>
                  Display name and city set
                </Ready>
                <Ready ok={myState.readiness.termsAccepted}>
                  Terms accepted
                </Ready>
                <Ready ok={myState.readiness.paymentSettled}>
                  Payment settled
                </Ready>
                <Ready ok={myState.readiness.registered}>Registered</Ready>
              </ul>
              <Link
                href="/settings"
                className="text-secondary mt-4 inline-flex text-sm underline"
              >
                Edit profile
              </Link>
            </Card>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-pixel text-2xl font-bold uppercase">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Card surface="broadcast" className="p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </Card>
  );
}

function TimelineRow({ label, date }: { label: string; date: Date | null }) {
  return (
    <div className="border-hairline flex items-center gap-3 border p-3">
      <CalendarDays className="text-secondary size-4" aria-hidden />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">
          {date ? formatDate(date) : 'Not scheduled'}
        </p>
      </div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <CheckCircle2
        className="text-secondary mt-1 size-4 shrink-0"
        aria-hidden
      />
      <span>{children}</span>
    </li>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <Card surface="broadcast" className="p-4">
      <h3 className="font-semibold">{q}</h3>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{a}</p>
    </Card>
  );
}

function Ready({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{children}</span>
      <Badge tone={ok ? 'success' : 'neutral'}>{ok ? 'Done' : 'Open'}</Badge>
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function aiStages(): string {
  return Object.entries(DEFAULT_STAGE_PROFILES)
    .filter(([, profile]) => profile === 'full')
    .map(([stage]) => formatStage(stage))
    .join(', ');
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function formatStage(value: string): string {
  return value.replace(/_/g, ' ');
}

function estimatedDuration(tournament: {
  simulationOpensAt: Date | null;
  liveStartsAt: Date | null;
  completedAt: Date | null;
}): string {
  const start = tournament.simulationOpensAt;
  const end = tournament.completedAt ?? tournament.liveStartsAt;
  if (!start || !end || end <= start) return 'Schedule dependent';
  const hours = Math.ceil((end.getTime() - start.getTime()) / 3_600_000);
  return `${hours}h scheduled`;
}
