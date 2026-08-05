import type { HallOfFameEntry } from '@/server/modules/hall-of-fame';
import type { LeaderboardEntry } from '@/server/modules/tournament';
import type { ProductNavUser } from '@/components/features/product-nav';

/**
 * Fixtures for the `/preview/*` design routes.
 *
 * These exist so a layout can be reviewed without standing up Postgres. They
 * are typed against the REAL interfaces on purpose: if a field is renamed in
 * the server module, these stop compiling rather than quietly drifting into a
 * mock-up of a page that no longer exists.
 */

export const PREVIEW_USER: ProductNavUser = {
  username: 'parth_dev',
  profileHref: '/u/parth_dev',
  unread: 3,
  isAdmin: true,
  canAccessTest: true,
};

const COMPETITORS: Array<[string, string, string, number]> = [
  ['aryan.builds', 'Aryan Verma', 'Bengaluru', 94.2],
  ['ishita.code', 'Ishita Sharma', 'Pune', 91.7],
  ['rohan.dev', 'Rohan Mehta', 'Hyderabad', 88.4],
  ['devansh.singh', 'Devansh Singh', 'Delhi', 84.9],
  ['ananya.builds', 'Ananya Iyer', 'Chennai', 81.3],
  ['kunal.kodes', 'Kunal Kapoor', 'Mumbai', 78.6],
  ['saanvi.dev', 'Saanvi Rao', 'Bengaluru', 74.1],
  ['mohit.c', 'Mohit Chauhan', 'Jaipur', 71.8],
  ['parth_dev', 'Parth Parmar', 'Ahmedabad', 68.5],
  ['neel.ships', 'Neel Joshi', 'Kolkata', 63.2],
  ['tara.builds', 'Tara Nair', 'Kochi', 58.7],
  ['vikram.exe', 'Vikram Bose', 'Indore', 51.4],
];

export const PREVIEW_ME = 'user-parth_dev';

export function leaderboardFixture(): LeaderboardEntry[] {
  return COMPETITORS.map(([username, displayName, city, score], index) => ({
    userId: `user-${username}`,
    username,
    displayName,
    city,
    seed: index + 1,
    simulationScore: score,
    placement: index + 1,
    qualified: index < 8,
    currentStage: index < 4 ? 'SF' : null,
    eliminatedAtStage: index >= 8 ? 'R16' : null,
  }));
}

function person(index: number) {
  const [username, displayName] = COMPETITORS[index]!;
  return { userId: `user-${username}`, username, displayName };
}

export function hallOfFameFixture(now: number): HallOfFameEntry[] {
  const DAY = 24 * 60 * 60 * 1000;

  return [
    {
      tournamentId: 'past-1',
      tournamentName: 'Circuit Weekly #31',
      tournamentSlug: 'circuit-weekly-31',
      publishedAt: new Date(now - 7 * DAY),
      participantCount: 32,
      prizePoolMinor: 4100000,
      champion: { ...person(0), city: 'Bengaluru' },
      runnerUp: person(1),
      thirdPlace: person(2),
    },
    {
      tournamentId: 'past-2',
      tournamentName: 'Circuit Weekly #30',
      tournamentSlug: 'circuit-weekly-30',
      publishedAt: new Date(now - 14 * DAY),
      participantCount: 24,
      prizePoolMinor: 3600000,
      champion: { ...person(2), city: 'Hyderabad' },
      runnerUp: person(4),
      thirdPlace: person(3),
    },
    {
      tournamentId: 'past-3',
      tournamentName: 'Launch Invitational',
      tournamentSlug: 'launch-invitational',
      publishedAt: new Date(now - 28 * DAY),
      participantCount: 16,
      prizePoolMinor: 0,
      champion: { ...person(1), city: 'Pune' },
      runnerUp: person(5),
      thirdPlace: null,
    },
  ];
}
