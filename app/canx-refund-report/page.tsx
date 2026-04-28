import { isReportAuthenticated, isReportAuthConfigured } from '@/lib/reportAuth';
import LoginForm from './LoginForm';
import CanxRefundReportView from './CanxRefundReportView';

export const dynamic = 'force-dynamic';

/**
 * Cancellation Refund Report — Internal Audit only.
 *
 * The page itself is the auth gate: server-side cookie check decides
 * between the inline login form and the live report. Mirrors the audit
 * data the canxrefundreporttfileonly.py script produced (Zendesk tickets
 * tagged postrefund / postrefundready in open / pending / hold), and
 * exposes a CSV download with the same column layout.
 *
 * Reuses WB_ADMIN_KEY as the access key — no new env var needed.
 */
export default function CanxRefundReportPage() {
  if (!isReportAuthConfigured()) {
    // Server hasn't been configured (no WB_ADMIN_KEY). Show the form
    // disabled so the page still renders something explanatory.
    return <LoginForm disabled />;
  }
  if (!isReportAuthenticated()) {
    return <LoginForm />;
  }
  return <CanxRefundReportView />;
}
