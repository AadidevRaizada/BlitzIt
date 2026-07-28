import { cn } from '@/lib/utils';

/**
 * DisplayHeading — the display face, at headline scale.
 *
 * Normal case, always. All-caps is reserved for `<Eyebrow />` and nav; a
 * headline shouting in caps was the single biggest reason the old UI read as a
 * game jam rather than a competitive platform. Callers should not add
 * `uppercase` here.
 *
 * The old scale topped out at 6rem for section headings, which meant a
 * routine "Standings" label rendered at near-hero size and flattened the
 * page's hierarchy. Sizes now step down properly: hero > section > compact >
 * panel.
 */
export function DisplayHeading({
  as = 'h2',
  size = 'section',
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h1' | 'h2' | 'h3';
  size?: 'hero' | 'section' | 'compact' | 'panel';
}) {
  const Component = as;

  return (
    <Component
      className={cn(
        'font-display text-balance',
        size === 'hero' &&
          'max-w-5xl text-[clamp(2.75rem,7vw,5rem)] leading-[0.98] font-bold tracking-[-0.035em]',
        size === 'section' &&
          'max-w-3xl text-[clamp(1.75rem,3.4vw,2.75rem)] leading-[1.05] font-bold tracking-[-0.03em]',
        size === 'compact' &&
          'text-[clamp(1.375rem,2.4vw,1.75rem)] leading-tight font-semibold tracking-[-0.02em]',
        // Panel titles sit above a card's contents without competing with the
        // section heading above them.
        size === 'panel' &&
          'text-[1.0625rem] leading-tight font-semibold tracking-[-0.01em]',
        className,
      )}
      {...props}
    />
  );
}
