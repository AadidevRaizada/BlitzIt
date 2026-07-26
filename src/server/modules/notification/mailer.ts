import 'server-only';
import { Resend } from 'resend';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Email delivery (E8.3).
 *
 * Structured the way D18 structured the LLM provider: the module depends on an
 * *interface*, and exactly one factory maps configuration to an implementation.
 * Nothing above this file knows Resend exists, so swapping provider is a
 * configuration change plus one adapter — never a change to the pipeline.
 *
 * Three implementations, chosen by configuration alone:
 *
 * | `RESEND_API_KEY` | `EMAIL_FROM` | Mailer |
 * |---|---|---|
 * | set | set | Resend |
 * | either missing | — | `noopMailer` |
 *
 * The no-op is not a stub to be replaced later — it is how the product behaves
 * in development, in CI and in any deployment that has not wired email. A
 * missing vendor must degrade to "the in-app notification still exists and the
 * email was skipped", never to a failed tournament transition.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  /** Provider message id, when the provider returns one. */
  id: string | null;
  /** True when nothing was actually transmitted (no provider configured). */
  skipped: boolean;
  provider: string;
}

export interface Mailer {
  readonly name: string;
  send(email: OutboundEmail): Promise<SendResult>;
}

/** Configured-off delivery. Logs, reports `skipped`, never throws. */
export const noopMailer: Mailer = {
  name: 'noop',
  async send(email) {
    logger.info(
      { to: redactEmail(email.to), subject: email.subject },
      'email delivery skipped: no provider configured',
    );
    return { id: null, skipped: true, provider: 'noop' };
  },
};

class ResendMailer implements Mailer {
  readonly name = 'resend';
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    const response = await this.client.emails.send({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    // The SDK reports failures in the payload rather than by throwing, so a
    // response that is not inspected looks exactly like a success.
    if (response.error) {
      throw new Error(
        `resend rejected the message: ${response.error.message ?? 'unknown error'}`,
      );
    }
    return {
      id: response.data?.id ?? null,
      skipped: false,
      provider: 'resend',
    };
  }
}

let cached: Mailer | undefined;

/**
 * The configured mailer. Memoised — building a client per send would create a
 * new connection pool for every notification.
 */
export function createMailer(): Mailer {
  if (cached) return cached;

  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    logger.warn(
      {
        hasKey: Boolean(env.RESEND_API_KEY),
        hasFrom: Boolean(env.EMAIL_FROM),
      },
      'email is not configured; notifications will be in-app only',
    );
    cached = noopMailer;
    return cached;
  }

  cached = new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  return cached;
}

/** Test seam: force a mailer, or clear the memo. */
export function setMailer(mailer: Mailer | null): void {
  cached = mailer ?? undefined;
}

/** `someone@example.com` → `s***@example.com`. Logs must not carry addresses. */
export function redactEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}
