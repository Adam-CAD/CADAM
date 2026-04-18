CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "status" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "level" "public"."stripe-level" DEFAULT 'pro'::"public"."stripe-level" NOT NULL,
    "current_period_end" timestamp with time zone,
    "stripe_event_created_at" timestamp with time zone,
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'canceled'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'past_due'::"text", 'trialing'::"text", 'unpaid'::"text"])))
);



CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_pkey ON "public"."subscriptions" USING btree (id);

ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY USING INDEX "subscriptions_pkey";

ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) not valid;

ALTER TABLE "public"."subscriptions" VALIDATE CONSTRAINT "subscriptions_user_id_fkey";


CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON "public"."subscriptions" USING "btree" ("stripe_customer_id");

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON "public"."subscriptions" USING "btree" ("stripe_subscription_id");

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_key ON "public"."subscriptions" USING "btree" ("stripe_subscription_id") WHERE ("stripe_subscription_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_event_created_at ON "public"."subscriptions" USING "btree" ("stripe_event_created_at");

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON "public"."subscriptions" USING "btree" ("user_id");


CREATE POLICY "Service role can manage all subscriptions" ON "public"."subscriptions" TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "Users can read their own subscriptions" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING ((SELECT "auth"."uid"()) = "user_id");

ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;
