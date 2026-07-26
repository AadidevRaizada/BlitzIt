import 'server-only';

/**
 * Hall of Fame module (E8.4).
 *
 * Owns: the permanent record of a finished tournament — podium, badges, and
 * the public history behind screens [3] and [4].
 *
 * Does NOT own: placements (the Tournament module computes them during
 * advancement), identity (Authentication), or prizes (E9). It reads standings
 * and freezes them; it never decides one.
 */

export {
  BADGE_SLUGS,
  BADGE_CATALOGUE,
  awardsForPlacements,
  podiumFromPlacements,
  type BadgeSlug,
  type BadgeDefinition,
  type BadgeAward,
  type PlacementInput,
  type Podium,
} from './badges.public';

export {
  publishHallOfFame,
  syncBadgeCatalogue,
  listHallOfFame,
  listUserBadges,
  userBadgeSlugs,
  type PublishResult,
  type HallOfFameEntry,
  type UserBadgeView,
} from './hall-of-fame';
