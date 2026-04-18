-- Run before applying supabase/migrations/20260418120000_security_hardening.sql.
-- The migration creates unique indexes that will fail if these queries return rows.

-- Purchased/subscription token references must be unique.
select source, reference_id, count(*) as duplicate_count
from public.token_transactions
where source in ('purchased', 'subscription')
  and reference_id is not null
group by source, reference_id
having count(*) > 1
order by duplicate_count desc, source, reference_id;

-- Stripe subscription IDs must be unique.
select stripe_subscription_id, count(*) as duplicate_count
from public.subscriptions
where stripe_subscription_id is not null
group by stripe_subscription_id
having count(*) > 1
order by duplicate_count desc, stripe_subscription_id;

-- Token-pack products should not map active duplicate Stripe lookup keys.
select stripe_lookup_key, count(*) as active_count
from public.token_pack_products
where active = true
group by stripe_lookup_key
having count(*) > 1
order by active_count desc, stripe_lookup_key;
