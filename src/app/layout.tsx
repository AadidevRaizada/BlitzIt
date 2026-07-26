import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { PostHogProvider } from '@/components/providers/posthog-provider';
import { Toaster } from '@/components/ui/sonner';

// Weights per docs/design-system.md §3. Exposed as --font-inter, which
// globals.css maps into the Tailwind `--font-sans` stack.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
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
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <PostHogProvider>{children}</PostHogProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
