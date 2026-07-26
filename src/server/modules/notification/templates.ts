import 'server-only';
import { publicEnv } from '@/lib/env';
import type { NotificationType } from '@/generated/prisma/client';
import {
  notificationContent,
  type NotificationContent,
} from './content.public';

/**
 * Email templates (E8.3).
 *
 * ## Why this is a string builder and not React Email
 *
 * The blueprint calls for React Email templates. They cannot be used here:
 * `@react-email/render` depends on `react-dom/server`, which **throws under the
 * `react-server` module condition** — and that is exactly the condition the
 * Next server runtime (and therefore our in-process job runner) resolves
 * modules under. Measured, not assumed:
 *
 * ```
 * node --conditions=react-server -e "…render(createElement('div'))"
 *   → Error: react-dom/server is not supported in React Server Components
 * node -e "…"                     → renders fine
 * ```
 *
 * An email template that only works outside the runtime that sends the email is
 * not a template. So the layout is built here as a string, which has no runtime
 * requirements at all, removed three dependencies, and is trivially testable.
 * The structure is deliberately the same one a React Email layout produces —
 * swapping back is a rewrite of this file and nothing else.
 *
 * ## Why the markup looks dated
 *
 * Because email clients are. Inline styles only (stylesheets are stripped), a
 * single column (flex and grid are unreliable), and hex colours rather than the
 * OKLCH design tokens (no client resolves CSS custom properties, and a token
 * falling back to black is worse than a duplicated literal).
 */

const BRAND_PURPLE = '#7F5AF0';
const INK = '#16161a';
const MUTED = '#6b7280';
const SURFACE = '#fffffe';
const PAGE = '#f4f4f5';
const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Escape text for HTML.
 *
 * Every interpolated value passes through here. Notification payloads carry
 * user-controlled strings — a display name, a tournament name — and an email is
 * still a document somebody's client will parse.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function absoluteUrl(path: string): string {
  const base = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The shared layout, given already-decided copy. */
export function renderEmailHtml(
  content: NotificationContent,
  recipientName?: string | null,
): string {
  const paragraphs = content.lines
    .map(
      (line) =>
        `<p style="color:${INK};font-size:15px;line-height:1.6;margin:0 0 12px">${escapeHtml(line)}</p>`,
    )
    .join('');

  const greeting = recipientName
    ? `<p style="color:${INK};font-size:15px;margin:0 0 12px">${escapeHtml(recipientName)},</p>`
    : '';

  const cta = content.cta
    ? `<div style="margin:24px 0 8px">
         <a href="${escapeHtml(absoluteUrl(content.cta.path))}"
            style="background-color:${BRAND_PURPLE};border-radius:8px;color:#ffffff;display:inline-block;font-size:15px;font-weight:600;padding:12px 20px;text-decoration:none">
           ${escapeHtml(content.cta.label)}
         </a>
       </div>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(content.subject)}</title>
  </head>
  <body style="background-color:${PAGE};margin:0;padding:24px 0;font-family:${FONT}">
    <!-- The inbox preview line. Without it, clients show the first body text,
         which is usually the greeting and says nothing. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.subject)}</div>
    <div style="background-color:${SURFACE};border-radius:12px;max-width:560px;margin:0 auto;padding:32px">
      <p style="color:${BRAND_PURPLE};font-size:13px;font-weight:700;letter-spacing:0.08em;margin:0 0 20px;text-transform:uppercase">Blitz It</p>
      <h1 style="color:${INK};font-size:22px;font-weight:700;line-height:1.3;margin:0 0 16px">${escapeHtml(content.heading)}</h1>
      ${greeting}
      ${paragraphs}
      ${cta}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px" />
      <p style="color:${MUTED};font-size:12px;line-height:1.6;margin:0">
        You are receiving this because you registered for a Blitz It tournament.
        Manage what reaches you in your
        <a href="${escapeHtml(absoluteUrl('/settings'))}" style="color:${BRAND_PURPLE}">settings</a>.
      </p>
    </div>
  </body>
</html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render one notification to the bodies a send needs.
 *
 * The plain-text alternative is built from the same `NotificationContent`, not
 * scraped out of the HTML: a text part that drifts from the HTML is the classic
 * way to ship an email that reads as spam to the clients that check both.
 */
export function renderNotificationEmail(
  type: NotificationType,
  payload: unknown,
  recipientName?: string | null,
): RenderedEmail {
  const content = notificationContent(type, payload);

  const text = [
    content.heading,
    '',
    ...content.lines,
    ...(content.cta
      ? ['', `${content.cta.label}: ${absoluteUrl(content.cta.path)}`]
      : []),
  ].join('\n');

  return {
    subject: content.subject,
    html: renderEmailHtml(content, recipientName),
    text,
  };
}
