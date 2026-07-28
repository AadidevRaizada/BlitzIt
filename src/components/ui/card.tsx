import { cn } from '@/lib/utils';

/**
 * Card.
 *
 * A card must sit one visible elevation step off the page — a lighter fill
 * plus a hairline, never a dashed outline. The old treatment was black-on-black
 * with a border, so cards dissolved into the background and every surface read
 * as flat.
 *
 * `emphasis` is how a list conveys priority without changing layout: a live
 * tournament and a finished one are the same component, but they must not
 * carry the same weight. `live` earns the red ring and glow; `muted` recedes.
 */
export function Card({
  className,
  interactive = false,
  surface = 'default',
  emphasis = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  surface?: 'default' | 'broadcast';
  emphasis?: 'default' | 'live' | 'primary' | 'muted';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border',
        'transition-[background-color,border-color,box-shadow,transform]',
        'duration-[var(--motion-base)] ease-[var(--ease-out-quart)]',
        surface === 'broadcast'
          ? 'bg-surface-raised text-card-foreground border-hairline'
          : 'bg-card text-card-foreground border-border',

        emphasis === 'live' &&
          'border-destructive/45 shadow-[var(--glow-live)]',
        emphasis === 'primary' && 'border-primary/45',
        emphasis === 'muted' && 'bg-transparent opacity-75',

        interactive &&
          cn(
            'focus-within:ring-ring focus-within:ring-2',
            'hover:border-primary/40 hover:shadow-md',
            surface === 'broadcast' && 'hover:bg-surface-elevated',
            'motion-safe:hover:-translate-y-0.5',
          ),
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-1 p-4', className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'font-display leading-tight font-semibold tracking-tight',
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-muted-foreground text-sm', className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0', className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-border flex items-center gap-2 border-t p-4',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Stat card — an eyebrow label over a big tabular number.
 *
 * Tabular figures are not cosmetic here: these sit in grids and several of
 * them tick live, so proportional digits would make the whole row jitter on
 * every update.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** `live` tints the value red. Reserve it for a value that is moving. */
  tone?: 'default' | 'live' | 'primary' | 'success';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-card border-border rounded-lg border p-4',
        'transition-colors duration-[var(--motion-base)]',
        tone === 'live' && 'border-destructive/40',
        className,
      )}
    >
      <p className="text-eyebrow text-muted-foreground font-semibold uppercase">
        {label}
      </p>
      <p
        className={cn(
          'font-display mt-1.5 text-2xl font-bold tabular-nums',
          tone === 'live' && 'text-destructive',
          tone === 'primary' && 'text-primary',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
