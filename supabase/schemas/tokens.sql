-- Configurable cost per operation
CREATE TABLE IF NOT EXISTS "public"."token_costs" (
    "operation" "public"."token_operation_type" NOT NULL,
    "cost" integer NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_costs_pkey ON "public"."token_costs" USING btree (operation);

ALTER TABLE "public"."token_costs" ADD CONSTRAINT "token_costs_pkey" PRIMARY KEY USING INDEX "token_costs_pkey";

ALTER TABLE "public"."token_costs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "token_costs_read" ON "public"."token_costs" FOR SELECT TO authenticated USING (true);

-- Default costs
INSERT INTO "public"."token_costs" ("operation", "cost") VALUES
    ('mesh', 30),
    ('parametric', 5),
    ('chat', 1)
ON CONFLICT (operation) DO NOTHING;

-- Per-user token balances
CREATE TABLE IF NOT EXISTS "public"."token_balances" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "source" "public"."token_source_type" NOT NULL,
    "balance" integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
    "expires_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_balances_pkey ON "public"."token_balances" USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS token_balances_user_id_source_key ON "public"."token_balances" USING btree (user_id, source);

ALTER TABLE "public"."token_balances" ADD CONSTRAINT "token_balances_pkey" PRIMARY KEY USING INDEX "token_balances_pkey";
ALTER TABLE "public"."token_balances" ADD CONSTRAINT "token_balances_user_id_source_key" UNIQUE USING INDEX "token_balances_user_id_source_key";

ALTER TABLE "public"."token_balances" ADD CONSTRAINT "token_balances_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE "public"."token_balances" VALIDATE CONSTRAINT "token_balances_user_id_fkey";

ALTER TABLE "public"."token_balances" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "token_balances_read_own" ON "public"."token_balances" FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Append-only audit log
CREATE TABLE IF NOT EXISTS "public"."token_transactions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY,
    "user_id" uuid NOT NULL,
    "operation" "public"."token_operation_type" NOT NULL,
    "amount" integer NOT NULL,
    "source" "public"."token_source_type" NOT NULL,
    "reference_id" text,
    "subscription_balance_after" integer NOT NULL,
    "purchased_balance_after" integer NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_transactions_pkey ON "public"."token_transactions" USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS token_transactions_purchased_reference_id_key ON "public"."token_transactions" USING btree (reference_id) WHERE ((source = 'purchased'::"public"."token_source_type") AND (reference_id IS NOT NULL) AND (amount > 0));
CREATE UNIQUE INDEX IF NOT EXISTS token_transactions_subscription_reference_id_key ON "public"."token_transactions" USING btree (reference_id) WHERE ((source = 'subscription'::"public"."token_source_type") AND (reference_id IS NOT NULL) AND (amount > 0));

ALTER TABLE "public"."token_transactions" ADD CONSTRAINT "token_transactions_pkey" PRIMARY KEY USING INDEX "token_transactions_pkey";

ALTER TABLE "public"."token_transactions" ADD CONSTRAINT "token_transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE "public"."token_transactions" VALIDATE CONSTRAINT "token_transactions_user_id_fkey";

ALTER TABLE "public"."token_transactions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "token_transactions_read_own" ON "public"."token_transactions" FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Token pack products (maps Stripe lookup keys to token amounts)
CREATE TABLE IF NOT EXISTS "public"."token_pack_products" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "stripe_lookup_key" text NOT NULL,
    "token_amount" integer NOT NULL,
    "name" text NOT NULL,
    "price_cents" integer NOT NULL,
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS token_pack_products_pkey ON "public"."token_pack_products" USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS token_pack_products_stripe_lookup_key_key ON "public"."token_pack_products" USING btree (stripe_lookup_key);

ALTER TABLE "public"."token_pack_products" ADD CONSTRAINT "token_pack_products_pkey" PRIMARY KEY USING INDEX "token_pack_products_pkey";
ALTER TABLE "public"."token_pack_products" ADD CONSTRAINT "token_pack_products_stripe_lookup_key_key" UNIQUE USING INDEX "token_pack_products_stripe_lookup_key_key";

ALTER TABLE "public"."token_pack_products" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "token_pack_products_read" ON "public"."token_pack_products" FOR SELECT TO authenticated USING (active = true);
