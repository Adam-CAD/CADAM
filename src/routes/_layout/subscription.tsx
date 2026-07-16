import { createFileRoute, redirect } from '@tanstack/react-router';
import { BILLING_URL, BILLING_UPGRADE_URL } from '@/config/billing';

// Billing moved to the accounts app; keep this stub so old
// adam.new/cadam/subscription links still land somewhere useful.
// ?trial used to open the trial dialog here — carry that intent
// through to the upgrade flow on the billing page.
export const Route = createFileRoute('/_layout/subscription')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: 'trial' in location.search ? BILLING_UPGRADE_URL : BILLING_URL,
    });
  },
});
