import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';

export const metadata = { title: 'Dashboard — Blitz It' };

/**
 * Competitor dashboard placeholder (E1). The real weekly dashboard — schedule,
 * countdown, pass state, seed — arrives with the tournament epics.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await requireUser('/dashboard');

  return (
    <div className="space-y-6">
      {error === 'forbidden' ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          You do not have access to that area.
        </p>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold">
          Welcome, {user.displayName ?? user.username}
        </h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {user.email} · role {user.role}
        </p>
      </div>

      <div className="border-border rounded-md border p-4 text-sm">
        <p className="font-medium">Authentication is live (Milestone 1).</p>
        <p className="text-muted-foreground mt-1">
          Tournaments, the simulation arena, and payments arrive in later
          milestones. Meanwhile you can{' '}
          <Link href="/settings" className="underline">
            edit your profile
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
