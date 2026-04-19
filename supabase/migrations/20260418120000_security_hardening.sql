CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
    event_id text PRIMARY KEY,
    event_type text NOT NULL,
    stripe_object_id text,
    stripe_event_created_at timestamptz,
    status text NOT NULL DEFAULT 'processing',
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
);

ALTER TABLE public.stripe_webhook_events
ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_object_created
ON public.stripe_webhook_events (stripe_object_id, stripe_event_created_at DESC)
WHERE stripe_object_id IS NOT NULL;

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
ADD COLUMN IF NOT EXISTS stripe_event_created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_event_created_at
ON public.subscriptions (stripe_event_created_at);

CREATE UNIQUE INDEX IF NOT EXISTS token_transactions_purchased_reference_id_key
ON public.token_transactions (reference_id)
WHERE source = 'purchased'::public.token_source_type
  AND reference_id IS NOT NULL
  AND amount > 0;

CREATE UNIQUE INDEX IF NOT EXISTS token_transactions_subscription_reference_id_key
ON public.token_transactions (reference_id)
WHERE source = 'subscription'::public.token_source_type
  AND reference_id IS NOT NULL
  AND amount > 0;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_key
ON public.subscriptions (stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.credit_purchased_tokens(
    p_user_id uuid,
    p_amount integer,
    p_reference_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    v_new_balance integer;
    v_sub_balance integer;
BEGIN
    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.token_transactions
        WHERE source = 'purchased'::public.token_source_type
          AND reference_id = p_reference_id
          AND amount > 0
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'tokensAdded', 0
        );
    END IF;

    INSERT INTO public.token_balances (user_id, source, balance)
    VALUES (p_user_id, 'purchased'::public.token_source_type, p_amount)
    ON CONFLICT (user_id, source) DO UPDATE
    SET balance = token_balances.balance + p_amount, updated_at = now()
    RETURNING balance INTO v_new_balance;

    SELECT COALESCE(balance, 0) INTO v_sub_balance
    FROM public.token_balances
    WHERE user_id = p_user_id AND source = 'subscription'::public.token_source_type;

    v_sub_balance := COALESCE(v_sub_balance, 0);

    INSERT INTO public.token_transactions (
        user_id, operation, amount, source, reference_id,
        subscription_balance_after, purchased_balance_after
    ) VALUES (
        p_user_id, 'chat'::public.token_operation_type, p_amount, 'purchased'::public.token_source_type, p_reference_id,
        v_sub_balance, v_new_balance
    );

    RETURN jsonb_build_object(
        'success', true,
        'tokensAdded', p_amount,
        'purchasedBalance', v_new_balance
    );
END;
$function$;

DROP FUNCTION IF EXISTS public.grant_subscription_tokens(uuid, integer, timestamptz);
DROP FUNCTION IF EXISTS public.grant_subscription_tokens(uuid, integer, timestamptz, text);

CREATE OR REPLACE FUNCTION public.grant_subscription_tokens(
    p_user_id uuid,
    p_token_amount integer,
    p_expires_at timestamptz,
    p_reference_id text DEFAULT NULL::text,
    p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
    v_pur_balance integer;
    v_sub_balance integer;
    v_sub_expires timestamptz;
BEGIN
    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.token_transactions
        WHERE source = 'subscription'::public.token_source_type
          AND reference_id = p_reference_id
          AND amount > 0
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'tokensGranted', 0
        );
    END IF;

    INSERT INTO public.token_balances (user_id, source, balance, expires_at)
    VALUES (p_user_id, 'subscription'::public.token_source_type, p_token_amount, p_expires_at)
    ON CONFLICT (user_id, source) DO UPDATE
    SET balance = p_token_amount, expires_at = p_expires_at, updated_at = now()
    WHERE p_force
       OR token_balances.expires_at IS NULL
       OR token_balances.expires_at < p_expires_at
    RETURNING balance, expires_at INTO v_sub_balance, v_sub_expires;

    IF NOT FOUND THEN
        SELECT balance, expires_at INTO v_sub_balance, v_sub_expires
        FROM public.token_balances
        WHERE user_id = p_user_id
          AND source = 'subscription'::public.token_source_type;

        RETURN jsonb_build_object(
            'success', true,
            'stale', true,
            'tokensGranted', 0,
            'subscriptionBalance', COALESCE(v_sub_balance, 0),
            'expiresAt', v_sub_expires
        );
    END IF;

    SELECT COALESCE(balance, 0) INTO v_pur_balance
    FROM public.token_balances
    WHERE user_id = p_user_id AND source = 'purchased'::public.token_source_type;

    v_pur_balance := COALESCE(v_pur_balance, 0);

    INSERT INTO public.token_transactions (
        user_id, operation, amount, source, reference_id,
        subscription_balance_after, purchased_balance_after
    ) VALUES (
        p_user_id, 'chat'::public.token_operation_type, p_token_amount, 'subscription'::public.token_source_type, COALESCE(p_reference_id, 'subscription_grant'),
        v_sub_balance, v_pur_balance
    );

    RETURN jsonb_build_object(
        'success', true,
        'tokensGranted', p_token_amount,
        'subscriptionBalance', v_sub_balance,
        'expiresAt', v_sub_expires
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.credit_purchased_tokens(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_subscription_tokens(uuid, integer, timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_tokens(uuid, public.token_operation_type, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_free_tier_tokens() FROM PUBLIC, anon, authenticated;
