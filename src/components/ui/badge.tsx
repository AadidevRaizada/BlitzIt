import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge / status pill.
 *
 * Colour policy (see globals.css):
 *   - `live` is RED. Red is reserved for things genuinely happening now, so
 *     this tone must never be used decoratively — a static red pill on a page
 *     where nothing is live is exactly the fake liveness this redesign set out
 *     to remove. Pair it with `<LiveDot />` for the heartbeat.
 *   - `active` / `brand` are BLUE: open, healthy, in progress, not urgent.
 *   - `success` is the desaturated status green, as a tint rather than a solid
 *     slab so a column of "Done" pills does not shout. `solidSuccess` exists
 *     for the rare case that needs the filled treatment.
 */
export const badgeVariants = cva(
  cn(
    'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5',
    'text-xs font-medium whitespace-nowrap',
  ),
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        info: 'bg-accent text-accent-foreground',
        brand: 'bg-primary/15 text-primary',
        active: 'bg-primary/15 text-primary ring-primary/25 ring-1 ring-inset',
        success: 'bg-success/15 text-success',
        solidSuccess: 'bg-success text-success-foreground',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-destructive/15 text-destructive',
        solidDanger: 'bg-destructive text-destructive-foreground',
        /** Elimination / sudden death. Loud on purpose. */
        knockout:
          'bg-destructive/20 text-destructive ring-destructive/40 font-semibold ring-1 ring-inset',
        outline: 'border-border text-foreground border',
        live: cn(
          'bg-destructive/15 text-destructive ring-destructive/35 ring-1 ring-inset',
          'font-semibold shadow-[var(--glow-live)]',
        ),
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/**
 * The heartbeat: a solid core with an expanding ping ring behind it. Two
 * concentric elements rather than one blinking dot, because a dot that only
 * changes opacity reads as a rendering glitch at small sizes.
 *
 * `motion-safe:` gates both animations, and the global reduced-motion rule in
 * globals.css pins them for users who ask for less motion — leaving a static
 * dot, which still carries the meaning.
 */
export function LiveDot({
  className,
  tone = 'destructive',
}: {
  className?: string;
  tone?: 'destructive' | 'primary' | 'success';
}) {
  const fill =
    tone === 'primary'
      ? 'bg-primary'
      : tone === 'success'
        ? 'bg-success'
        : 'bg-destructive';

  return (
    <span
      aria-hidden
      className={cn('relative flex size-1.5 shrink-0', className)}
    >
      <span
        className={cn(
          'absolute inline-flex size-full rounded-full opacity-70',
          fill,
          'motion-safe:animate-[var(--animate-live-ping)]',
        )}
      />
      <span
        className={cn(
          'relative inline-flex size-full rounded-full',
          fill,
          'motion-safe:animate-[var(--animate-live-pulse)]',
        )}
      />
    </span>
  );
}
