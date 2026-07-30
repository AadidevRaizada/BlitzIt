import 'server-only';

export {
  getSession,
  getCurrentUser,
  requireUser,
  requireAdmin,
  requireUserOrThrow,
  requireAdminOrThrow,
  requireTestAccess,
  requireTestAccessOrThrow,
  getUserByUsername,
  type SessionContext,
} from './session';

export {
  isAdmin,
  hasRole,
  canAccess,
  isTester,
  canAccessTestEnvironment,
  AUTOMATION_ACTOR,
} from './roles';

export { syncDomainUser, ensureProfile, slugifyUsername } from './sync';
export {
  assertOnboardingComplete,
  completeOnboarding,
  getOnboardingState,
  type OnboardingState,
} from './onboarding';
