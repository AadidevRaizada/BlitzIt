import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Page header — title, optional description, optional back link, and a slot for
 * the page's primary action. One primary action per view (design-system §7).
 */
export function PageHeader({
  title,
  description,
  back,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? (
            <div className="text-muted-foreground text-sm">{description}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Section heading inside a page. Quiet, uppercase, consistent everywhere. */
export function SectionTitle({
  children,
  className,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h2 className="text-sm font-semibold tracking-wide uppercase">
        {children}
      </h2>
      {actions}
    </div>
  );
}

/** Label/value pair used across the detail surfaces. */
export function DataRow({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-0.5', className)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * All timestamps are stored UTC (D8). IST is the display timezone for V1, so
 * both are shown — the operator schedules in UTC but thinks in IST.
 */
export function formatUtc(date: Date | null | undefined): string {
  if (!date) return '—';
  return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function formatIst(date: Date | null | undefined): string {
  if (!date) return '—';
  return `${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date)} IST`;
}

/** Value for a `datetime-local` input, in UTC. */
export function toDateTimeLocal(date: Date | null | undefined): string {
  if (!date) return '';
  return date.toISOString().slice(0, 16);
}
