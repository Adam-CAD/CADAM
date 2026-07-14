import { createFileRoute, redirect } from '@tanstack/react-router';
import { BILLING_URL } from '@/config/billing';

// Billing moved to the accounts app; keep this stub so old
// adam.new/cadam/subscription links still land somewhere useful.
export const Route = createFileRoute('/_layout/subscription')({
  beforeLoad: () => {
    throw redirect({ href: BILLING_URL });
  },
});
