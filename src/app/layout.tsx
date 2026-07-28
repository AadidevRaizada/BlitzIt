import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { PostHogProvider } from '@/components/providers/posthog-provider';
import { Toaster } from '@/components/ui/sonner';

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

export const metadata: Metadata = {
  title: 'The Circuit - 15 Minutes. One Shot. Just Ship.',
  description:
    'A competitive, AI-native coding esport. Understand a problem, wield AI, and ship a working solution under extreme time pressure.',
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
