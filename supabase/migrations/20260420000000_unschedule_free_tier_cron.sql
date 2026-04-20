-- Unschedule the free-tier cron. adam-billing now owns free-tier refreshes
-- (it runs its own /v1/cron/refresh-free-tier against its own DB), so CADAM's
-- reset_free_tier_tokens() no longer needs to fire. The function itself is
-- preserved for now as part of the deferred-drop plan; a follow-up migration
-- will drop the billing tables/functions after adam-billing is stable.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'reset-free-tier-tokens'
    ) THEN
        PERFORM cron.unschedule('reset-free-tier-tokens');
    END IF;
END;
$$;
