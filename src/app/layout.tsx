import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { PostHogProvider } from '@/components/providers/posthog-provider';
import { Toaster } from '@/components/ui/sonner';
import { publicEnv } from '@/lib/env';

// Two families, max — see globals.css.
//
// Body/UI face. Exposed as --font-inter, which globals.css maps into the
// Tailwind `--font-sans` stack.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

// Display face for headlines, scores and timers. Geometric and
// monospace-adjacent, with tabular figures so numbers do not jitter as they
// tick. Self-hosted by next/font, so there is no third-party font request.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
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
        className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <PostHogProvider>{children}</PostHogProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
