/**
 * Shared top navigation — copied from the InsureTec Dashboard repo
 * per docs/CROSS_APP_INTEGRATION.md §3. Keep this file as close to
 * the dashboard's verbatim version as possible so visual parity is
 * preserved; drift will need a thin npm package later.
 *
 * Two adaptations vs. the dashboard's copy (per the integration guide):
 *   1. `import type { User } from '@/lib/db'` → `from '@/lib/auth'`
 *      (our local stand-in re-exports WbUser as `User`).
 *   2. Wallboards adds 'wb' to the currentApp union.
 *
 * Every other line stays a 1:1 copy. If you find yourself reaching
 * for a tweak here, consider whether it should land in the dashboard
 * first and be re-pulled.
 */
import Link from 'next/link';
import BrandMark from './BrandMark';
import UserMenu from './UserMenu';
import CalendarMenu from './CalendarMenu';
import AnnouncementsMenu from './AnnouncementsMenu';
import RemindersMenu from './RemindersMenu';
import BackButton from './BackButton';
import { hasCalAccess, hasAnnAccess, hasRemAccess, isCalAdmin } from '@/lib/auth';
import type { User } from '@/lib/auth';
import styles from './topnav.module.css';

type Props = {
  user: User;
  currentApp?: 'dashboard' | 'qm-scorer' | 'call-transcriber' | 'cancellation-calculator' | 'calendar' | 'myportal' | 'academy' | 'ann' | 'rem' | 'rota' | 'nf' | 'ask' | 'smr' | 'hd' | 'zr' | 'inv' | 'sd' | 'wb';
};

export default function TopNav({ user, currentApp = 'wb' }: Props) {
  // currentApp is accepted for parity with the dashboard's prop shape;
  // the bar itself doesn't render a pill (the eyebrow per page does
  // that job — see the dashboard comment on the original).
  void currentApp;

  return (
    <header className={styles.topnav}>
      <div className={styles.inner}>
        <BackButton />
        <Link href="/" className={styles.brand} aria-label="InsureTec Dashboard home">
          <BrandMark size={36} />
          <div className={styles.brandText}>
            <div className={styles.brandName}>
              Insure<span>Tec</span>
            </div>
            <div className={styles.brandSub}>Dashboard</div>
          </div>
        </Link>

        <div className={styles.spacer} />

        {hasRemAccess(user) && <RemindersMenu />}
        {hasAnnAccess(user) && <AnnouncementsMenu />}
        {hasCalAccess(user) && user.department && (
          <CalendarMenu department={user.department} canCreate={isCalAdmin(user)} />
        )}

        <UserMenu user={user} />
      </div>
    </header>
  );
}
