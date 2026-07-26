import 'server-only';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { ForbiddenError } from '@/lib/errors';
import { CURRENT_TERMS_VERSION } from './policies';

export interface TermsAcceptanceInput {
  userId: string;
  version?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function acceptTerms(
  input: TermsAcceptanceInput,
  client: DbClient = db,
): Promise<{ version: string; acceptedAt: Date }> {
  const version = input.version ?? CURRENT_TERMS_VERSION;
  const row = await client.termsAcceptance.upsert({
    where: { idempotencyKey: `terms:${input.userId}:${version}` },
    update: {},
    create: {
      userId: input.userId,
      version,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      idempotencyKey: `terms:${input.userId}:${version}`,
    },
    select: { id: true, acceptedAt: true },
  });

  await recordAudit(
    {
      actorId: input.userId,
      action: 'compliance.termsAccepted',
      entityType: 'TermsAcceptance',
      entityId: row.id,
      after: {
        userId: input.userId,
        version,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    },
    client,
  );

  return { version, acceptedAt: row.acceptedAt };
}

export async function hasAcceptedCurrentTerms(
  userId: string,
  client: DbClient = db,
): Promise<boolean> {
  const count = await client.termsAcceptance.count({
    where: { userId, version: CURRENT_TERMS_VERSION },
  });
  return count > 0;
}

export async function assertCurrentTermsAccepted(
  userId: string,
  client: DbClient = db,
): Promise<void> {
  if (!(await hasAcceptedCurrentTerms(userId, client))) {
    throw new ForbiddenError(
      'Accept the current terms before entering a paid tournament.',
    );
  }
}
