import { cn } from '@/lib/utils';

/**
 * The Circuit wordmark, and the DEVHUB/Circuit lockup built from it.
 *
 * ## Why this is a mask and not an `<img>`
 *
 * The wordmark is a raster with a distressed texture (see
 * `scripts/build-brand-assets.ts` — these assets are temporary until a vector
 * redraw exists). Shipping it as an image would mean shipping one file per ink
 * colour and then choosing between them at runtime, which is genuinely awkward
 * here: `[data-surface]` forces dark on the marketing and app shells
 * regardless of the user's theme, while admin follows `.dark` like a normal
 * page. A component that tried to detect that would be wrong somewhere.
 *
 * Painting the alpha channel with `currentColor` sidesteps the whole problem.
 * One asset, and the mark is whatever the surrounding text colour is — which
 * is the correct answer on every surface by construction.
 *
 * The two tinted PNGs in `public/brand/` remain for the places a mask cannot
 * reach: Open Graph cards and email.
 */

/** Intrinsic ratio of the extracted wordmark (668x599). */
const WORDMARK_RATIO = 668 / 599;

export function Wordmark({
  className,
  label = 'The Circuit',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('block bg-current', className)}
      style={{
        aspectRatio: WORDMARK_RATIO,
        maskImage: 'url(/brand/wordmark-dark.png)',
        WebkitMaskImage: 'url(/brand/wordmark-dark.png)',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}

/** The "C" alone — for widths where the two-line wordmark is unreadable. */
export function Monogram({
  className,
  label = 'The Circuit',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('block bg-current', className)}
      style={{
        aspectRatio: 106 / 281,
        maskImage: 'url(/brand/monogram.png)',
        WebkitMaskImage: 'url(/brand/monogram.png)',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}

/**
 * Org over product: DEVHUB runs the platform, The Circuit is the tournament
 * series. Stated as a hierarchy rather than two competing logos, because we
 * have a mark for the product and only a name for the org.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('flex flex-col gap-1', className)}>
      <span className="font-display text-muted-foreground text-[0.6rem] leading-none font-bold tracking-[0.18em] uppercase">
        Devhub
      </span>
      <Wordmark className="h-7" />
    </span>
  );
}
