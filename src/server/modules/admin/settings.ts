import 'server-only';
import { db } from '@/server/db';
import type { DbClient } from './audit';

export const COMMUNITY_WHATSAPP_URL_KEY = 'community.whatsappUrl';

export interface PlatformSettings {
  communityWhatsAppUrl: string | null;
}

export async function getPlatformSettings(
  client: DbClient = db,
): Promise<PlatformSettings> {
  const row = await client.platformSetting.findUnique({
    where: { key: COMMUNITY_WHATSAPP_URL_KEY },
    select: { value: true },
  });

  return { communityWhatsAppUrl: row?.value || null };
}

export async function updateCommunityWhatsAppUrl(
  value: string | null,
  client: DbClient = db,
): Promise<PlatformSettings> {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    await client.platformSetting.deleteMany({
      where: { key: COMMUNITY_WHATSAPP_URL_KEY },
    });
    return { communityWhatsAppUrl: null };
  }

  const row = await client.platformSetting.upsert({
    where: { key: COMMUNITY_WHATSAPP_URL_KEY },
    update: { value: trimmed },
    create: { key: COMMUNITY_WHATSAPP_URL_KEY, value: trimmed },
    select: { value: true },
  });
  return { communityWhatsAppUrl: row.value };
}
