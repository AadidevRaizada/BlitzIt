import { cn } from '@/lib/utils';

export function DisplayHeading({
  as = 'h2',
  size = 'section',
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h1' | 'h2' | 'h3';
  size?: 'hero' | 'section' | 'compact';
}) {
  const Component = as;

  return (
    <Component
      className={cn(
        'text-wrap-balance max-w-4xl font-extrabold tracking-[-0.035em]',
        size === 'hero' && 'text-[clamp(3.4rem,9vw,6rem)] leading-[0.95]',
        size === 'section' && 'text-[clamp(2.2rem,5vw,4.8rem)] leading-[0.98]',
        size === 'compact' && 'text-[clamp(1.8rem,4vw,3rem)] leading-tight',
        className,
      )}
      {...props}
    />
  );
}
