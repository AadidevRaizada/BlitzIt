import {
  listRegistrations,
  type TournamentSummary,
} from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import { SectionTitle, formatIst } from '@/components/ui/page-header';
import { RemoveRegistrationButton } from './remove-registration';

/**
 * Registrations tab (E5).
 *
 * The blueprint has no approve/reject step — registration is unconditional once
 * the window is open, and E4 will gate it on a paid pass instead. So the only
 * operator action here is removal, which is a REVOKE: submissions, evaluations
 * and the audit trail are all kept.
 *
 * Removal is refused once the tournament has been seeded, because a bracket
 * slot would then reference someone no longer in the tournament.
 */
export async function RegistrationsTab({
  summary,
}: {
  summary: TournamentSummary;
}) {
  const registrations = await listRegistrations(summary.id);
  const active = registrations.filter((r) => r.status === 'ACTIVE');
  const sealed = Boolean(summary.bracketSize && summary.matches > 0);

  return (
    <div className="space-y-4">
      <SectionTitle
        actions={
          <span className="text-muted-foreground text-xs">
            {active.length} active of {registrations.length} total
          </span>
        }
      >
        Competitors
      </SectionTitle>

      {sealed ? (
        <p className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm">
          The bracket has been generated. Competitors can no longer be removed —
          doing so would leave an unfillable slot.
        </p>
      ) : null}

      {registrations.length === 0 ? (
        <EmptyState
          title="No registrations yet"
          hint="Competitors appear here once registration opens and they enter."
        />
      ) : (
        <TableShell>
          <THead>
            <TH>Competitor</TH>
            <TH>Status</TH>
            <TH numeric>Seed</TH>
            <TH numeric>Submissions</TH>
            <TH>Registered</TH>
            <TH numeric>Actions</TH>
          </THead>
          <TBody>
            {registrations.map((registration) => (
              <TR key={registration.id}>
                <TD>
                  <span className="font-medium">{registration.username}</span>
                  <span className="text-muted-foreground block text-xs">
                    {registration.email}
                    {registration.city ? ` · ${registration.city}` : ''}
                  </span>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      tone={
                        registration.status === 'ACTIVE'
                          ? 'success'
                          : registration.status === 'REVOKED'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {registration.status}
                    </Badge>
                    {registration.paid ? (
                      <Badge tone="outline">Paid</Badge>
                    ) : null}
                    {registration.eliminatedAtStage ? (
                      <Badge tone="neutral">
                        Out · {registration.eliminatedAtStage}
                      </Badge>
                    ) : null}
                  </div>
                </TD>
                <TD numeric>
                  {registration.seed ?? '—'}
                  {registration.qualified ? (
                    <span className="text-muted-foreground block text-xs">
                      qualified
                    </span>
                  ) : null}
                </TD>
                <TD numeric>{registration.submissions}</TD>
                <TD>
                  <span className="text-xs">
                    {formatIst(registration.registeredAt)}
                  </span>
                </TD>
                <TD numeric>
                  {registration.status === 'ACTIVE' && !sealed ? (
                    <RemoveRegistrationButton
                      tournamentId={summary.id}
                      userId={registration.userId}
                      username={registration.username}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </div>
  );
}
