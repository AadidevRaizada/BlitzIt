import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Button.
 *
 * Every variant carries four real states: hover, focus-visible (2px ring at
 * 2px offset — never removed), pressed, and disabled. "Real" means a visible
 * change in fill, border or elevation; a cursor change alone does not count.
 *
 * Labels are normal case. All-caps + tracking belongs to `<Eyebrow />` and nav
 * only, so the old uppercase `broadcast` label is gone — it now earns weight
 * from size, fill and glow instead.
 *
 * Server-component friendly: no client hooks, so it renders in RSC pages and
 * inside client islands alike.
 */
export const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow,opacity,transform]',
    'duration-[var(--motion-fast)] ease-[var(--ease-out-quart)]',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
    'focus-visible:ring-offset-background active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:pointer-events-none',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        primary: cn(
          'bg-primary text-primary-foreground',
          'hover:brightness-110 hover:shadow-[var(--glow-primary)]',
          'active:brightness-95',
        ),
        secondary: cn(
          'border-input bg-transparent border',
          'hover:bg-accent hover:text-accent-foreground hover:border-primary/40',
        ),
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        danger: cn(
          'bg-destructive text-destructive-foreground',
          'hover:brightness-110 hover:shadow-[var(--glow-live)] active:brightness-95',
        ),
        success: cn(
          'bg-success text-success-foreground',
          'hover:brightness-110 active:brightness-95',
        ),
        /** The page-level call to action. Loud by size and glow, not by caps. */
        broadcast: cn(
          'bg-primary text-primary-foreground border-primary/40 border font-semibold',
          'shadow-[var(--glow-primary)]',
          'hover:brightness-110 motion-safe:hover:-translate-y-0.5',
          'active:translate-y-0 active:brightness-95',
        ),
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        broadcast: 'min-h-12 px-6 py-3 text-sm',
        icon: 'size-9',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
