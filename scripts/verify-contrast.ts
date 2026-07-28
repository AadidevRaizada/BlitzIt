/**
 * Contrast verification for the design tokens in src/app/globals.css.
 *
 * The design system claims specific contrast ratios. This script computes them
 * from the shipped token values rather than trusting the comments, so a token
 * tweak that quietly breaks AA fails here instead of in production.
 *
 * Run: npm run verify:contrast
 */

type Oklch = { l: number; c: number; h: number };

/** OKLCH -> linear sRGB (Björn Ottosson's matrices). */
function oklchToLinearSrgb({
  l: L,
  c: C,
  h: H,
}: Oklch): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

/** WCAG relative luminance. Inputs are linear-light sRGB, clamped to gamut. */
function luminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(color).map((v) =>
    Math.min(1, Math.max(0, v)),
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Oklch, b: Oklch): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const ok = (l: number, c: number, h: number): Oklch => ({ l, c, h });

// Mirrors src/app/globals.css. Keep in sync when tokens move.
const T = {
  base1000: ok(0.118, 0.006, 265),
  base950: ok(0.145, 0.006, 265),
  base900: ok(0.172, 0.007, 265),
  base850: ok(0.208, 0.008, 265),
  base800: ok(0.248, 0.009, 265),
  ink100: ok(0.975, 0.002, 265),
  ink300: ok(0.802, 0.006, 265),
  ink500: ok(0.638, 0.009, 265),
  blue400: ok(0.702, 0.176, 250),
  blue500: ok(0.618, 0.204, 252),
  blue600: ok(0.542, 0.212, 254),
  red400: ok(0.682, 0.203, 25),
  red500: ok(0.602, 0.232, 25),
  red600: ok(0.532, 0.222, 25),
  green400: ok(0.752, 0.142, 158),
  green500: ok(0.672, 0.152, 158),
  green600: ok(0.508, 0.118, 158),
  amber400: ok(0.805, 0.152, 78),
  amber600: ok(0.405, 0.088, 62),
  white: ok(1, 0, 0),
} as const;

/** `min` is the WCAG floor: 4.5 for body text, 3.0 for large text and UI. */
const CHECKS: Array<{ name: string; fg: Oklch; bg: Oklch; min: number }> = [
  // --- Dark product surfaces (broadcast + workspace share --base-950). ---
  { name: 'foreground on background', fg: T.ink100, bg: T.base950, min: 4.5 },
  {
    name: 'muted-foreground on background',
    fg: T.ink500,
    bg: T.base950,
    min: 4.5,
  },
  { name: 'muted-foreground on card', fg: T.ink500, bg: T.base850, min: 4.5 },
  { name: 'ink-300 on card', fg: T.ink300, bg: T.base850, min: 4.5 },
  {
    name: 'foreground on surface-elevated',
    fg: T.ink100,
    bg: T.base800,
    min: 4.5,
  },

  // --- Accents as text on dark. Blue is the link/live colour, so it must
  //     clear AA body text, not merely large-text. ---
  {
    name: 'primary (blue-400) on background',
    fg: T.blue400,
    bg: T.base950,
    min: 4.5,
  },
  {
    name: 'primary (blue-400) on card',
    fg: T.blue400,
    bg: T.base850,
    min: 4.5,
  },
  {
    name: 'destructive (red-400) on background',
    fg: T.red400,
    bg: T.base950,
    min: 4.5,
  },
  {
    name: 'destructive (red-400) on card',
    fg: T.red400,
    bg: T.base850,
    min: 4.5,
  },
  {
    name: 'success (green-400) on background',
    fg: T.green400,
    bg: T.base950,
    min: 4.5,
  },
  {
    name: 'warning (amber-400) on background',
    fg: T.amber400,
    bg: T.base950,
    min: 4.5,
  },

  // --- Solid accent fills need a readable foreground. ---
  {
    name: 'primary-foreground on primary fill',
    fg: T.base1000,
    bg: T.blue400,
    min: 4.5,
  },
  {
    name: 'destructive-foreground on destructive fill',
    fg: T.base1000,
    bg: T.red400,
    min: 4.5,
  },
  {
    name: 'success-foreground on success fill',
    fg: T.base1000,
    bg: T.green400,
    min: 4.5,
  },
  {
    name: 'warning-foreground on warning fill',
    fg: T.base1000,
    bg: T.amber400,
    min: 4.5,
  },

  // --- Light surface (admin / operator). ---
  {
    name: 'light: primary (blue-600) on white',
    fg: T.blue600,
    bg: T.white,
    min: 4.5,
  },
  {
    name: 'light: white on primary fill',
    fg: T.white,
    bg: T.blue600,
    min: 4.5,
  },
  {
    name: 'light: white on destructive fill',
    fg: T.white,
    bg: T.red600,
    min: 4.5,
  },
  {
    name: 'light: white on success fill',
    fg: T.white,
    bg: T.green600,
    min: 4.5,
  },
  {
    name: 'light: warning (amber-600) on white',
    fg: T.amber600,
    bg: T.white,
    min: 4.5,
  },
  {
    name: 'light: white on warning fill',
    fg: T.white,
    bg: T.amber600,
    min: 4.5,
  },

  // --- Focus ring must be visible against every surface it lands on. ---
  {
    name: 'ring (blue-400) vs background',
    fg: T.blue400,
    bg: T.base950,
    min: 3,
  },
  { name: 'ring (blue-500) vs white', fg: T.blue500, bg: T.white, min: 3 },
];

let failed = 0;
const rows = CHECKS.map((check) => {
  const ratio = contrast(check.fg, check.bg);
  const pass = ratio >= check.min;
  if (!pass) failed += 1;
  return { ...check, ratio, pass };
});

const width = Math.max(...rows.map((r) => r.name.length));
for (const row of rows) {
  const status = row.pass ? 'PASS' : 'FAIL';
  console.log(
    `${status}  ${row.name.padEnd(width)}  ${row.ratio.toFixed(2).padStart(6)}  (min ${row.min})`,
  );
}

console.log(
  `\n${rows.length - failed}/${rows.length} pairs meet their contrast floor.`,
);

if (failed > 0) {
  console.error(`\n${failed} contrast check(s) failed.`);
  process.exit(1);
}
