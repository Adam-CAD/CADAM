CREATE TABLE IF NOT EXISTS "public"."stripe_webhook_events" (
    "event_id" text NOT NULL,
    "event_type" text NOT NULL,
    "stripe_object_id" text,
    "stripe_event_created_at" timestamptz,
    "status" text NOT NULL DEFAULT 'processing',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "processed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS stripe_webhook_events_pkey ON "public"."stripe_webhook_events" USING btree (event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_object_created ON "public"."stripe_webhook_events" USING btree ("stripe_object_id", "stripe_event_created_at" DESC) WHERE ("stripe_object_id" IS NOT NULL);

ALTER TABLE "public"."stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY USING INDEX "stripe_webhook_events_pkey";

ALTER TABLE "public"."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;
