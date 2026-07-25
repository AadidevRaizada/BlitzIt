import 'server-only';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { logger } from '@/lib/logger';

/**
 * Append-only audit trail (module 11 — Admin).
 *
 * Every privileged or state-changing action records what changed, who changed
 * it, and what it looked like before. Lives in the Admin module because
 * `AuditLog` is its data; the tournament engine calls in rather than owning a
 * second audit concept.
 */

/** Anything that can run a query: the client, or a transaction handle. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  /** Null for system actors (cron, runner). */
  actorId?: string | null;
  /** Dotted verb, e.g. `tournament.transition`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string | null;
}

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

/**
 * Record an audit entry. Pass the transaction handle when the audited write is
 * part of a transaction, so the trail and the change commit or roll back
 * together — a logged change that never happened is worse than no log.
 */
export async function recordAudit(
  entry: AuditEntry,
  client: DbClient = db,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: asJson(entry.before),
      after: asJson(entry.after),
      correlationId: entry.correlationId ?? null,
    },
  });
}

/**
 * Best-effort variant for paths where losing the audit row must not fail the
 * operation (e.g. logging a *rejected* action). Use `recordAudit` for anything
 * that mutates state.
 */
export async function tryRecordAudit(
  entry: AuditEntry,
  client: DbClient = db,
): Promise<void> {
  try {
    await recordAudit(entry, client);
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error, ...entry },
      'failed to write audit entry',
    );
  }
}
