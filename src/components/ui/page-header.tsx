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
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {title}
          </h1>
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

/**
 * Section heading inside a page — a section eyebrow, so all-caps + tracking is
 * the sanctioned treatment here. It shares the `--text-eyebrow` token with
 * `<Eyebrow />` so the two cannot drift apart.
 *
 * Five pages had this exact class string pasted inline instead of using this
 * component; those now call it, which is the point of it existing.
 */
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
      <h2 className="text-eyebrow text-muted-foreground font-semibold uppercase">
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
 * Timestamps are STORED in UTC (D8) — that does not change, and must not.
 * Everything the operator reads or types is IST.
 *
 * IST is UTC+05:30 with no daylight saving, ever. That is why a fixed offset is
 * correct here and no timezone library is needed; if The Circuit ever runs in a
 * DST-observing zone this constant has to become a real tz lookup.
 */
export const IST_OFFSET_MINUTES = 330;

export function formatIst(date: Date | null | undefined): string {
  if (!date) return '—';
  return `${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date)} IST`;
}

/**
 * Value for a `datetime-local` input, rendered in IST.
 *
 * A `datetime-local` input carries no timezone, so whatever this returns is
 * what the operator sees and edits. It previously returned UTC while the field
 * was labelled only "Registration opens", so an operator typing the IST time
 * they meant had every schedule silently stored 5h30m late — which is exactly
 * how `2026-w2` ended up refusing registrations that its own countdown said
 * were open. Pair this with `istDateTime` in the admin schema; the two must
 * always change together.
 */
export function toDateTimeLocal(date: Date | null | undefined): string {
  if (!date) return '';
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 16);
}
