import { cn } from '@/lib/utils';

/**
 * Card — design-system §8. `--card` surface, 1px border, `--radius-lg`,
 * padding 4–6. Elevation on hover only when the card is interactive.
 */
export function Card({
  className,
  interactive = false,
  surface = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  surface?: 'default' | 'broadcast';
}) {
  return (
    <div
      className={cn(
        surface === 'broadcast'
          ? 'bg-surface-raised text-card-foreground border-hairline rounded-lg border'
          : 'bg-card text-card-foreground border-border rounded-lg border',
        interactive &&
          (surface === 'broadcast'
            ? 'focus-within:ring-ring hover:bg-surface-elevated transition-[background-color,transform] duration-200 focus-within:ring-2 motion-safe:hover:-translate-y-0.5'
            : 'focus-within:ring-ring transition-shadow focus-within:ring-2 hover:shadow-sm'),
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
      className={cn('leading-tight font-semibold tracking-tight', className)}
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
 * Stat card — label (caption, muted) over a tabular value, per §8. Tabular
 * numerals matter here: these sit in grids where digits must line up.
 */
export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('bg-card border-border rounded-lg border p-4', className)}
    >
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
