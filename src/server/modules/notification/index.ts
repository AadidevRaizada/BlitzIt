import 'server-only';

/**
 * Notification module (module 10 in docs/04-module-breakdown) — E8.3.
 *
 * Owns: notification intents, their dedupe rule, the in-app list, and delivery
 * over email.
 *
 * Does NOT own: what is worth notifying about. A business module raises an
 * intent when something happens in ITS domain and returns; nothing here reaches
 * back into a tournament to decide whether an event occurred.
 */

export {
  notificationDedupeKey,
  channelsFor,
  isEmailChannel,
  isNotificationSettled,
  CHANNEL_POLICY,
  NOTIFICATION_LABEL,
  type NotificationSubject,
  type NotificationType,
  type NotificationChannel,
  type NotificationStatus,
} from './types.public';

export {
  notificationContent,
  parseNotificationPayload,
  notificationPayloadSchema,
  formatMinor,
  type NotificationContent,
  type NotificationPayload,
} from './content.public';

export {
  raiseNotification,
  raiseNotifications,
  listMyNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationIntent,
  type NotificationView,
  type RaiseResult,
} from './notifications';

export {
  dispatchNotificationEmails,
  dispatchUndeliveredEmails,
  deliverNotificationEmail,
  markNotificationFailed,
} from './delivery';

export {
  createMailer,
  setMailer,
  noopMailer,
  redactEmail,
  type Mailer,
  type OutboundEmail,
  type SendResult,
} from './mailer';

export {
  renderNotificationEmail,
  renderEmailHtml,
  escapeHtml,
  absoluteUrl,
  type RenderedEmail,
} from './templates';
