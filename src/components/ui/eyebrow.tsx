import { cn } from '@/lib/utils';

/**
 * Eyebrow — the ONLY sanctioned all-caps + letter-spaced treatment in the
 * product, alongside nav labels.
 *
 * The rule this enforces (design system §3): all-caps + tracked belongs to
 * section eyebrows and nav. Everything else, including every headline, is
 * normal case. Before this existed the same
 * `font-mono text-xs uppercase tracking-[0.18em]` string was pasted into ~30
 * places with four different tracking values, which is how the type system
 * drifted in the first place.
 *
 * `tone` is deliberately narrow. An eyebrow is a label, not a status: use
 * `live` only when the thing it labels is genuinely happening now.
 */
export function Eyebrow({
  as = 'p',
  tone = 'muted',
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: 'p' | 'span' | 'div' | 'h2';
  tone?: 'muted' | 'primary' | 'live' | 'foreground';
}) {
  const Component = as;

  return (
    <Component
      className={cn(
        // Mono, because an eyebrow is a machine label — the same register as a
        // status, a timer or a score, and deliberately not the register of the
        // sentence underneath it.
        'text-eyebrow font-mono font-semibold uppercase',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'primary' && 'text-primary',
        tone === 'live' && 'text-destructive',
        tone === 'foreground' && 'text-foreground',
        className,
      )}
      {...props}
    />
  );
}
