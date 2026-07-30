/**
 * Build the brand raster assets from the single canonical source.
 *
 * ## This is a temporary, raster-based solution
 *
 * `circuit logo.png` is a 1536x1024 *screenshot-style* export holding BOTH
 * treatments side by side — dark ink on a light gradient on the left, white on
 * black on the right — each with a soft glow and a vignette baked into the
 * pixels. It is a wordmark; there is no compact glyph in it.
 *
 * So every asset here is derived, not authored, and none of them is final:
 *
 *   - The distressed texture is a raster. It cannot be recoloured beyond the
 *     two tints produced below, and it will not stay crisp above ~2x.
 *   - A 16px favicon cut from a distressed wordmark is a compromise. The "C"
 *     monogram is the most legible thing available in this file, not the right
 *     answer. A redrawn vector mark replaces all of this.
 *
 * Keeping the derivation in a committed script rather than checking in
 * hand-edited PNGs means the day that vector arrives, the diff is this file.
 *
 * Run: npx tsx scripts/build-brand-assets.ts
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE = path.join(process.cwd(), 'circuit logo.png');
const BRAND_DIR = path.join(process.cwd(), 'public', 'brand');
const APP_DIR = path.join(process.cwd(), 'src', 'app');

/**
 * Regions measured off the source, not guessed.
 *
 * The right half is the white-on-black treatment; a luminance sweep puts the
 * wordmark's ink at x 822-1469, y 185-763, with the line break between "THE"
 * and "CIRCUIT" at y 481 and the C of CIRCUIT ending at x 941.
 */
const WORDMARK = { left: 812, top: 175, width: 668, height: 599 };
// Tight to the C's own ink. The next letter's leading edge starts at x 948, and
// the six pixels before it are enough to render a stray vertical sliver at
// favicon size, so this stops at 939 rather than at the measured letter gap.
const MONOGRAM = { left: 834, top: 486, width: 106, height: 281 };

/** oklch(0.118 0.006 265) and oklch(0.975 0.002 265) from globals.css. */
const BASE_1000 = { r: 5, g: 5, b: 7 };
const INK_100 = { r: 246, g: 247, b: 248 };

/**
 * Turn "white ink on a glowing black field" into a clean alpha mask.
 *
 * The source's glow is a wide, low-luminance skirt around every letter. Using
 * luminance directly as alpha would carry that halo into the PNG and it would
 * read as a grey smudge on any background that is not black. The linear ramp
 * drops everything below `floor` to fully transparent and everything above
 * `ceil` to fully opaque, which discards the skirt while keeping the
 * distressed edge detail that sits in between.
 */
async function alphaMask(region: sharp.Region, floor = 90, ceil = 175) {
  return sharp(SOURCE)
    .extract(region)
    .removeAlpha()
    .greyscale()
    .linear(255 / (ceil - floor), (-255 * floor) / (ceil - floor))
    .toColorspace('b-w')
    .toBuffer();
}

/** Tint one mask a flat colour — same shape, two themes, no second crop. */
async function tinted(
  mask: Buffer,
  region: sharp.Region,
  colour: { r: number; g: number; b: number },
) {
  return sharp({
    create: {
      width: region.width,
      height: region.height,
      channels: 3,
      background: colour,
    },
  })
    .joinChannel(mask)
    .png()
    .toBuffer();
}

/** Centre a transparent asset on an opaque square. */
async function onSquare(
  input: Buffer,
  size: number,
  inset: number,
  background: { r: number; g: number; b: number; alpha: number },
) {
  const inner = await sharp(input)
    .resize(size - inset * 2, size - inset * 2, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(BRAND_DIR, { recursive: true });

  const wordmarkMask = await alphaMask(WORDMARK);
  const monogramMask = await alphaMask(MONOGRAM);

  // Two tints of one mask. `wordmark-dark` is the light-ink version drawn ON
  // dark surfaces; `wordmark-light` is the dark-ink version drawn on light.
  const onDark = await tinted(wordmarkMask, WORDMARK, INK_100);
  const onLight = await tinted(wordmarkMask, WORDMARK, BASE_1000);
  const monogram = await tinted(monogramMask, MONOGRAM, INK_100);

  await sharp(onDark).toFile(path.join(BRAND_DIR, 'wordmark-dark.png'));
  await sharp(onLight).toFile(path.join(BRAND_DIR, 'wordmark-light.png'));
  await sharp(monogram).toFile(path.join(BRAND_DIR, 'monogram.png'));

  // Favicon: the monogram, because the two-line wordmark is unreadable at
  // 16px. Opaque square rather than transparent — a transparent white "C"
  // disappears entirely against a light browser chrome.
  await sharp(await onSquare(monogram, 512, 56, { ...BASE_1000, alpha: 1 }))
    .png()
    .toFile(path.join(APP_DIR, 'icon.png'));

  // Home-screen icon and social card: the full wordmark, which has room here.
  await sharp(await onSquare(onDark, 512, 64, { ...BASE_1000, alpha: 1 }))
    .png()
    .toFile(path.join(APP_DIR, 'apple-icon.png'));

  const og = await sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: { ...BASE_1000, alpha: 1 },
    },
  })
    .composite([
      {
        input: await sharp(onDark)
          .resize(560, 500, {
            fit: 'inside',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .toBuffer(),
        gravity: 'center',
      },
    ])
    .png()
    .toBuffer();
  await sharp(og).toFile(path.join(APP_DIR, 'opengraph-image.png'));

  console.log('brand assets written:');
  console.log('  public/brand/wordmark-dark.png');
  console.log('  public/brand/wordmark-light.png');
  console.log('  public/brand/monogram.png');
  console.log('  src/app/icon.png');
  console.log('  src/app/apple-icon.png');
  console.log('  src/app/opengraph-image.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
