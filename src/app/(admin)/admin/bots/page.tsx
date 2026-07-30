import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import { listBots } from '@/server/modules/bot';
import { listTournamentSummaries } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  PageHeader,
  SectionTitle,
  formatIst,
} from '@/components/ui/page-header';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import { TestEnvironmentBanner } from '@/components/features/environment-switch';
import { AddBotsButton, CreateBotForm, DeleteBotButton } from './bot-controls';

export const metadata = { title: 'Bots - The Circuit Admin' };
export const dynamic = 'force-dynamic';

/**
 * Screen: test bots (D35).
 *
 * Bots fill bracket slots so a test tournament can reach the D6 minimum of 8
 * without eight real testers. The minimum itself is untouched — a bot holds a
 * genuine registration and is counted like anyone else, so "3 testers + 5 bots"
 * really is a field of 8.
 */
export default async function BotsPage() {
  const admin = await requireAdmin('/admin/bots');

  const [bots, testTournaments] = await Promise.all([
    listBots(admin),
    listTournamentSummaries({ environment: 'TEST', take: 50 }),
  ]);

  // Only tournaments that can actually accept an entry right now. Offering the
  // button against a closed tournament would produce a row of refusals.
  const fillable = testTournaments.filter(
    (tournament) => tournament.status === 'REGISTRATION_OPEN',
  );
  const allBotIds = bots.map((bot) => bot.userId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Test bots"
        description="Synthetic competitors for test tournaments. They register, submit, get evaluated, advance and appear in brackets exactly like a person — they simply never touch GitHub."
      />

      <TestEnvironmentBanner />

      <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <section className="space-y-3">
          <SectionTitle>New bot</SectionTitle>
          <CreateBotForm />
        </section>

        <section className="space-y-3">
          <SectionTitle>Fill a test tournament</SectionTitle>
          {fillable.length === 0 ? (
            <EmptyState
              title="No test tournament is taking registrations"
              description="Create a test tournament and open registration to add bots to its field."
            />
          ) : (
            <div className="space-y-3">
              {fillable.map((tournament) => {
                // How many more entrants this tournament needs to be seedable.
                const needed = Math.max(
                  0,
                  (tournament.minRegistrations ?? 8) - tournament.eligibleCount,
                );
                return (
                  <Card key={tournament.id} className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/admin/tournaments/${tournament.id}`}
                        className="font-medium hover:underline"
                      >
                        {tournament.name}
                      </Link>
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {tournament.eligibleCount} eligible
                        {needed > 0 ? ` · needs ${needed} more` : ' · ready'}
                      </span>
                    </div>
                    <AddBotsButton
                      tournamentId={tournament.id}
                      botUserIds={allBotIds}
                      label={
                        needed > 0
                          ? `Add all bots (${allBotIds.length})`
                          : 'Add all bots'
                      }
                    />
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <SectionTitle>All bots</SectionTitle>
        {bots.length === 0 ? (
          <EmptyState
            title="No bots yet"
            description="Create one above. Five bots plus three real testers make a legal 8-player bracket."
          />
        ) : (
          <TableShell>
            <THead>
              <TH>Bot</TH>
              <TH numeric>Skill</TH>
              <TH>Submits</TH>
              <TH>Score mode</TH>
              <TH>In tournaments</TH>
              <TH>Created</TH>
              <TH>{''}</TH>
            </THead>
            <TBody>
              {bots.map((bot) => (
                <TR key={bot.userId}>
                  <TD>
                    <p className="flex items-center gap-2 font-medium">
                      {bot.displayName ?? bot.username}
                      <Badge tone="neutral">BOT</Badge>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {bot.username}
                    </p>
                  </TD>
                  <TD numeric>{bot.skill}</TD>
                  <TD>
                    <Badge
                      tone={
                        bot.submitBehaviour === 'NEVER' ? 'warning' : 'neutral'
                      }
                    >
                      {bot.submitBehaviour}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge
                      tone={bot.scoreMode === 'TIE' ? 'warning' : 'neutral'}
                    >
                      {bot.scoreMode}
                    </Badge>
                  </TD>
                  <TD>
                    {bot.registrations.length === 0 ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {bot.registrations.map((registration) => (
                          <li key={registration.tournamentId}>
                            <Link
                              href={`/admin/tournaments/${registration.tournamentId}`}
                              className="hover:underline"
                            >
                              {registration.tournamentName}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                  <TD>{formatIst(bot.createdAt)}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <DeleteBotButton
                        botUserId={bot.userId}
                        username={bot.username}
                      />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </section>
    </div>
  );
}
