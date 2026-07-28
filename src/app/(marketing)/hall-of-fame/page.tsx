import Link from 'next/link';
import { Medal, Trophy } from 'lucide-react';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { Card } from '@/components/ui/card';
import { Reward } from '@/components/ui/reward';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Section } from '@/components/ui/section';
import { EmptyState } from '@/components/ui/table';

export const metadata = { title: 'Hall of Fame - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function HallOfFamePage() {
  const entries = await listHallOfFame({ take: 100 });

  return (
    <main>
      <Section className="bg-surface-deep">
        <Eyebrow tone="primary">Permanent record</Eyebrow>
        <DisplayHeading as="h1" className="mt-3">
          Hall of Fame
        </DisplayHeading>
        <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
          Every published tournament, its podium, and the field it was won
          against.
        </p>
      </Section>

      <Section className="bg-background">
        {entries.length === 0 ? (
          <EmptyState
            title="No champions yet"
            description="The first tournament to finish will be recorded here."
          />
        ) : (
          <ol className="stagger space-y-5">
            {entries.map((entry, index) => (
              <li key={entry.tournamentId}>
                <Card
                  surface="broadcast"
                  interactive
                  className="overflow-hidden"
                >
                  <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
                    {/* The champion half is the point of the card, so it gets
                        the raised fill and the only accent on the row. */}
                    <div className="bg-surface-elevated relative overflow-hidden p-6">
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_65%)]" />
                      <div className="relative flex items-center justify-between gap-4">
                        <span className="font-display text-muted-foreground text-sm font-bold tabular-nums">
                          #{index + 1}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {entry.publishedAt.toISOString().slice(0, 10)}
                        </span>
                      </div>
                      <Trophy
                        className="text-primary relative mt-10 size-10"
                        aria-hidden
                      />
                      <Eyebrow className="relative mt-4">Champion</Eyebrow>
                      <DisplayHeading
                        as="h2"
                        size="compact"
                        className="relative mt-2"
                      >
                        <Person
                          username={entry.champion?.username ?? null}
                          name={
                            entry.champion?.displayName ??
                            entry.champion?.username ??
                            null
                          }
                        />
                      </DisplayHeading>
                      {entry.champion?.city ? (
                        <p className="text-muted-foreground relative mt-2 text-sm">
                          {entry.champion.city}
                        </p>
                      ) : null}
                    </div>

                    <div className="p-6">
                      <Eyebrow>Tournament</Eyebrow>
                      <DisplayHeading
                        as="h3"
                        size="panel"
                        className="mt-1.5 text-xl"
                      >
                        {entry.tournamentName}
                      </DisplayHeading>
                      <p className="text-muted-foreground mt-2 text-sm tabular-nums">
                        {entry.participantCount} competitors ·{' '}
                        <Reward amountMinor={entry.prizePoolMinor} /> prize pool
                      </p>

                      <div className="mt-8 grid gap-3 sm:grid-cols-2">
                        <Place
                          rank="Runner-up"
                          username={entry.runnerUp?.username ?? null}
                          name={
                            entry.runnerUp?.displayName ??
                            entry.runnerUp?.username ??
                            null
                          }
                        />
                        <Place
                          rank="Third"
                          username={entry.thirdPlace?.username ?? null}
                          name={
                            entry.thirdPlace?.displayName ??
                            entry.thirdPlace?.username ??
                            null
                          }
                        />
                      </div>

                      <Link
                        href={`/bracket/${entry.tournamentId}`}
                        className="text-primary focus-visible:ring-ring mt-8 inline-flex rounded-md text-sm font-semibold hover:brightness-125 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        See bracket
                      </Link>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </main>
  );
}

function Place({
  rank,
  name,
  username,
}: {
  rank: string;
  name: string | null;
  username: string | null;
}) {
  return (
    <div className="border-hairline bg-surface-deep hover:border-primary/40 min-h-28 rounded-md border p-4 transition-colors duration-[var(--motion-base)]">
      <Medal className="text-muted-foreground size-5" aria-hidden />
      <Eyebrow className="mt-4">{rank}</Eyebrow>
      <p className="mt-1 font-semibold">
        <Person username={username} name={name} />
      </p>
    </div>
  );
}

function Person({
  username,
  name,
}: {
  username: string | null;
  name: string | null;
}) {
  if (!name || !username) {
    return <span className="text-muted-foreground">Unclaimed</span>;
  }

  return (
    <Link
      href={`/u/${username}`}
      className="hover:text-primary focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      {name}
    </Link>
  );
}
