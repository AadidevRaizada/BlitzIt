import type { Metadata } from 'next';
import { Archivo, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { PostHogProvider } from '@/components/providers/posthog-provider';
import { Toaster } from '@/components/ui/sonner';
import { publicEnv } from '@/lib/env';

// Three faces, three jobs — see globals.css for the rule.
//
// Body/UI face. Exposed as --font-inter, which globals.css maps into the
// Tailwind `--font-sans` stack.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

// Display face. Archivo replaces Space Grotesk: the brand wordmark is a heavy
// condensed grotesque, and Space Grotesk's quirky geometric forms fought it —
// every headline read as a different brand from the logo above it. Archivo is
// a broadcast-grade grotesque from the same family tree, so a headline set in
// it looks like it belongs under THE CIRCUIT.
//
// Variable, so the whole 400-800 range costs one file.
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
});

// Data face — timers, scores, prices, counts, eyebrows. A coding esport's
// clock should read like a race clock and a terminal at once, and JetBrains
// Mono's figures are genuinely monospaced, so a countdown cannot jitter no
// matter what the digits do.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const DESCRIPTION =
  'A competitive, AI-native coding esport. Understand a problem, wield AI, and ship a working solution under extreme time pressure.';

export const metadata: Metadata = {
  // Absolute URLs for the social card. Without a metadataBase, Next resolves
  // `opengraph-image.png` against localhost and every shared link renders a
  // broken preview in production.
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: 'The Circuit - 15 Minutes. One Shot. Just Ship.',
  description: DESCRIPTION,
  applicationName: 'The Circuit',
  openGraph: {
    title: 'The Circuit - 15 Minutes. One Shot. Just Ship.',
    description: DESCRIPTION,
    siteName: 'The Circuit',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${archivo.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <PostHogProvider>{children}</PostHogProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
