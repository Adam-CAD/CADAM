CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "current_message_leaf_id" "uuid",
    "share_token" "text",
    "is_public" boolean DEFAULT false
);


CREATE UNIQUE INDEX IF NOT EXISTS conversations_pkey ON "public"."conversations" USING btree (id);

ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_pkey" PRIMARY KEY USING INDEX "conversations_pkey";

ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."conversations" VALIDATE CONSTRAINT "conversations_user_id_fkey";


CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON "public"."conversations" USING btree (created_at);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON "public"."conversations" USING btree (updated_at);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON "public"."conversations" USING btree (user_id);


CREATE POLICY "Users can manage their own conversations" ON "public"."conversations" USING ( (SELECT "auth"."uid"()) = "user_id" );

ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;
