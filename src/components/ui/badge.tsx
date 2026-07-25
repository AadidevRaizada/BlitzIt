import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge / status pill — design-system §2 and §8.
 *
 * Colour is reserved for action and state, so badges are the main place an
 * accent appears in the admin surface. `success` uses the brand secondary,
 * which the design system requires to carry a BLACK foreground.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        info: 'bg-accent text-accent-foreground',
        brand: 'bg-primary/15 text-primary',
        success: 'bg-success text-success-foreground',
        warning: 'bg-warning/20 text-warning-foreground',
        danger: 'bg-destructive/15 text-destructive',
        solidDanger: 'bg-destructive text-destructive-foreground',
        outline: 'border-border text-foreground border',
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
