import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Button — design-system §7.
 *
 * Every variant carries the four required states: hover, focus-visible (2px
 * ring, offset 2px — never removed), pressed, disabled. `success` pairs the
 * secondary accent with a BLACK foreground, which the design system marks as a
 * hard rule (white on `#00FFA3` is 1.33:1).
 *
 * Server-component friendly: no client hooks, so it renders in RSC pages and
 * inside client islands alike.
 */
export const buttonVariants = cva(
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,opacity,transform] duration-120',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
    'focus-visible:ring-offset-background active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:pointer-events-none',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary:
          'border-input bg-background hover:bg-accent hover:text-accent-foreground border',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
        success: 'bg-success text-success-foreground hover:opacity-90',
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
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
