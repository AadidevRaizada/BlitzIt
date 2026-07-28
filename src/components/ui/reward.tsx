// Imported from `content.public` rather than the module barrel: the barrel is
// marked `server-only`, and this is a shared primitive that must stay usable
// from client components too.
import { formatMinor } from '@/server/modules/notification/content.public';
import { cn } from '@/lib/utils';

/**
 * What a competitor is playing for.
 *
 * Deliberately supports two framings, because the final legal/commercial
 * framing is still open and the UI must not hard-code either one:
 *
 *   - a currency amount (`amountMinor` + `currency`), e.g. a ₹ prize pool, and
 *   - a non-monetary reward (`description`), e.g. "Direct final seed".
 *
 * `description` wins when both are supplied, so a tournament can override the
 * money framing without a code change. When there is nothing to show it falls
 * back to a quiet placeholder rather than rendering a bare "₹0", which reads
 * as a broken value rather than an undecided one.
 */
export function Reward({
  amountMinor,
  currency = 'INR',
  description,
  fallback = 'To be announced',
  className,
}: {
  amountMinor?: number | null;
  currency?: string;
  description?: string | null;
  fallback?: string;
  className?: string;
}) {
  if (description) {
    return <span className={className}>{description}</span>;
  }

  if (amountMinor != null && amountMinor > 0) {
    return (
      <span className={cn('tabular-nums', className)}>
        {formatMinor(amountMinor, currency)}
      </span>
    );
  }

  return (
    <span className={cn('text-muted-foreground', className)}>{fallback}</span>
  );
}

/**
 * Entry cost. Same idea: a zero price is a real, meaningful state ("free to
 * enter"), not a missing one, so it gets its own label rather than "₹0".
 */
export function EntryPrice({
  amountMinor,
  currency = 'INR',
  freeLabel = 'Free entry',
  className,
}: {
  amountMinor?: number | null;
  currency?: string;
  freeLabel?: string;
  className?: string;
}) {
  if (amountMinor == null) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  if (amountMinor <= 0) {
    return <span className={className}>{freeLabel}</span>;
  }

  return (
    <span className={cn('tabular-nums', className)}>
      {formatMinor(amountMinor, currency)}
    </span>
  );
}
